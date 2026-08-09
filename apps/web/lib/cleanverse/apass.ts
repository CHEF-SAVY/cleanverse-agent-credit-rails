/**
 * A-Pass (CVI) — operator identity.
 *
 * An agent's operator onboards by receiving an A-Pass bound to their wallet. Everything the credit
 * stack knows about "who is behind this agent" starts here.
 */

import { cleanverseRequest, CleanverseApiError } from "./client";
import { getCleanverseConfig } from "./env";
import {
  ApassStatus,
  VerifyApassCode,
  isApassUsable,
  type ApassRecord,
  type Chain,
} from "./types";

const CUSTOMER_ID_PATTERN = /^[A-Za-z0-9]{12,}$/;

export type IdType =
  | "ID_CARD"
  | "PASSPORT"
  | "DRIVER_LICENSE"
  | "HK_MACAO_TAIWAN_PASS"
  | "RESIDENCE_PERMIT";

export interface IdentityData {
  idType: IdType;
  fullName: string;
  /**
   * ISO-3166-1 alpha-2. **Required** — omitting it fails with
   * "The issuing country cannot be empty". Cleanverse derives the A-Pass `countries` tags from
   * these, uppercased and deduplicated across documents.
   */
  issuingCountryISO2: string;
  /** The raw number, or its SHA-256 hash in hex — Cleanverse accepts either. */
  idNumber?: string;
  /** `yyyy-MM-dd`. */
  validUntil?: string;
}

export interface GenerateApassArgs {
  /**
   * Unique customer identifier. **12+ characters, strictly `[A-Za-z0-9]`** — no hyphens,
   * underscores or spaces. A UUID will be rejected; use {@link toCustomerId}.
   */
  customerId: string;
  walletAddress: string;
  /** Unix **seconds**. */
  expirationTime: number;
  chain?: Chain;
  kycSource?: string;
  kycId?: string;
  subTier?: number;
  subGroup?: string;
  identityDataList?: IdentityData[];
  override?: boolean;
}

export class InvalidCustomerIdError extends Error {
  constructor(customerId: string) {
    super(
      `customerId "${customerId}" is invalid: Cleanverse requires at least 12 characters of ` +
        "[A-Za-z0-9] only — no hyphens, underscores or spaces. Use toCustomerId() to derive one.",
    );
    this.name = "InvalidCustomerIdError";
  }
}

/**
 * Derive a conforming customerId from an arbitrary identifier (a wallet address, a UUID).
 *
 * Strips every disallowed character and pads short results, so a UUID or `0x`-prefixed address
 * becomes something the API accepts without the caller having to know the rule.
 */
export function toCustomerId(source: string): string {
  const cleaned = source.replace(/[^A-Za-z0-9]/g, "");
  return cleaned.length >= 12 ? cleaned : cleaned.padEnd(12, "0");
}

/**
 * Issue an A-Pass. Encrypted request.
 *
 * Note this mints real KYC'd identity in the sandbox — it is not a read. Callers should treat it
 * as part of operator onboarding, not something to retry casually in a loop.
 */
export async function generateApass(args: GenerateApassArgs): Promise<{ customerId: string }> {
  if (!CUSTOMER_ID_PATTERN.test(args.customerId)) {
    throw new InvalidCustomerIdError(args.customerId);
  }

  const chain = args.chain ?? getCleanverseConfig().defaultChain;
  return cleanverseRequest(
    "/generate_apass",
    {
      customerId: args.customerId,
      expirationTime: args.expirationTime,
      wallet: { address: args.walletAddress, chain },
      ...(args.kycSource ? { kycSource: args.kycSource } : {}),
      ...(args.kycId ? { kycId: args.kycId } : {}),
      ...(args.subTier !== undefined ? { subTier: args.subTier } : {}),
      ...(args.subGroup ? { subGroup: args.subGroup } : {}),
      ...(args.identityDataList ? { identityDataList: args.identityDataList } : {}),
      ...(args.override !== undefined ? { override: args.override } : {}),
    },
    { encrypted: true },
  );
}

/**
 * Read an A-Pass by wallet address. Plain JSON.
 *
 * Returns `null` rather than throwing when no pass exists — "this operator hasn't onboarded" is an
 * expected state on a dashboard, not an exception.
 */
export async function queryApass(
  walletAddress: string,
  chain?: Chain,
): Promise<ApassRecord | null> {
  const resolved = chain ?? getCleanverseConfig().defaultChain;
  try {
    return await cleanverseRequest<ApassRecord>(
      "/query_apass",
      { chain: resolved, address: walletAddress },
      { encrypted: false },
    );
  } catch (error) {
    if (error instanceof CleanverseApiError && /apass not found/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

/**
 * Whether a wallet may hold or receive a given A-Token.
 *
 * This matters more than it first appears: A-Token transfers are **recipient-gated**, so a payout
 * to a wallet without a usable pass will revert. Checking here turns that into a clean "not
 * eligible" up front instead of a failed settlement later.
 */
export async function verifyApassForToken({
  walletAddress,
  atokenAddress,
  chain,
}: {
  walletAddress: string;
  atokenAddress: string;
  chain?: Chain;
}): Promise<{ code: VerifyApassCode; allowed: boolean }> {
  const resolved = chain ?? getCleanverseConfig().defaultChain;
  const data = await cleanverseRequest<{ result: number }>(
    "/verify_apass",
    { chain: resolved, address: walletAddress, atoken_address: atokenAddress },
    { encrypted: false },
  );
  const code = data.result as VerifyApassCode;
  return { code, allowed: code === VerifyApassCode.Allowed };
}

/** Freeze (2) or reactivate (1) a pass. Encrypted request. */
export async function updateApassStatus({
  customerId,
  status,
}: {
  customerId: string;
  status: ApassStatus;
}): Promise<{ customerId: string; status: ApassStatus }> {
  return cleanverseRequest("/update_status", { customerId, status }, { encrypted: true });
}

/**
 * Everything the credit layer needs to know about an operator, in one read.
 *
 * `usable` folds together active status and expiry — the two ways a pass stops backing credit
 * without anyone taking an action.
 */
export async function getOperatorIdentity(
  walletAddress: string,
  chain?: Chain,
): Promise<
  | { onboarded: false; apass: null }
  | { onboarded: true; apass: ApassRecord; usable: boolean }
> {
  const apass = await queryApass(walletAddress, chain);
  if (!apass) return { onboarded: false, apass: null };
  return { onboarded: true, apass, usable: isApassUsable(apass) };
}
