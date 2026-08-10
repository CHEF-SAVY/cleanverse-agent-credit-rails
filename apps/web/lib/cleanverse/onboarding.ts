/**
 * Onboarding — binding an A-Pass to an address.
 *
 * Used for two different kinds of address, deliberately through one code path:
 *
 *   - **operator wallets**, so an agent's operator can be credit-scored by tier, and
 *   - **our own contracts**, because aUSDC gates its *recipients*: `CreditPool` and `JobEscrow`
 *     cannot receive a single unit of the asset without a pass of their own. Verified on-chain
 *     2026-08-09 — a contract recipient reverts `NoAPass(address)` exactly as a bare wallet does,
 *     and aUSDC's policy demands `minTier >= 5`.
 *
 * Idempotent by construction. `customerId` is derived from the address rather than generated, so
 * a retry, a double-clicked form, or a re-run of the deploy script resolves to the same customer
 * and cannot mint a second pass.
 */

import { generateApass, queryApass, toCustomerId, type IdentityData } from "./apass";
import { getBand, type BandLabel } from "./bands";
import { getCleanverseConfig } from "./env";
import { isApassUsable, parseTier, type ApassRecord, type Chain } from "./types";

/** One year. Long enough to outlive the credit lines it backs, short enough to force a re-KYC. */
const DEFAULT_VALIDITY_DAYS = 365;

export interface OnboardArgs {
  address: string;
  chain?: Chain;
  /** Defaults to one year from now. */
  validityDays?: number;
  /** Optional richer identity, when we have it from a KYC provider. */
  kycSource?: string;
  kycId?: string;
  subTier?: number;
  subGroup?: string;
  /**
   * Identity documents backing the pass. Real onboarding submits these; Cleanverse derives
   * `countries` from them, and they are the plausible input to how it assigns `tier`.
   */
  identityDataList?: IdentityData[];
  /**
   * Onboard into a named credit band, which sets `subTier` to that band's value.
   *
   * Ignored when `subTier` is given explicitly. Contracts (`CreditPool`, `JobEscrow`) take no
   * band: they must custody the asset, never borrow, so they need only clear the asset's own
   * transfer floor.
   */
  band?: BandLabel;
}

export interface OnboardResult {
  address: string;
  customerId: string;
  /** False when a usable pass already existed and nothing was minted. */
  created: boolean;
  apass: ApassRecord | null;
  tier: number;
  /** Whether the pass is active and unexpired — the thing that actually matters downstream. */
  usable: boolean;
}

/**
 * Ensure `address` holds a usable A-Pass, creating one only if it does not.
 *
 * Returns the resulting pass either way. A pass that exists but is frozen or expired is *not*
 * silently replaced — that is a compliance state someone decided on, and quietly minting over it
 * would defeat the point of the freeze. Callers should surface it instead.
 */
export async function ensureApass(args: OnboardArgs): Promise<OnboardResult> {
  const chain = args.chain ?? getCleanverseConfig().defaultChain;
  const customerId = toCustomerId(args.address);

  const existing = await queryApass(args.address, chain);
  if (existing) {
    return {
      address: args.address,
      customerId,
      created: false,
      apass: existing,
      tier: parseTier(existing.tier),
      usable: isApassUsable(existing),
    };
  }

  const validityDays = args.validityDays ?? DEFAULT_VALIDITY_DAYS;
  const expirationTime = Math.floor(Date.now() / 1000) + validityDays * 24 * 60 * 60;

  await generateApass({
    customerId,
    walletAddress: args.address,
    expirationTime,
    chain,
    kycSource: args.kycSource,
    kycId: args.kycId,
    identityDataList: args.identityDataList,
    subTier: args.subTier ?? (args.band ? getBand(args.band)?.subTier : undefined),
    subGroup: args.subGroup,
  });

  // Read back rather than trusting the write: the tier is assigned by Cleanverse, not by us, and
  // it is the number every downstream credit decision depends on.
  const created = await queryApass(args.address, chain);

  return {
    address: args.address,
    customerId,
    created: true,
    apass: created,
    tier: created ? parseTier(created.tier) : 0,
    usable: created ? isApassUsable(created) : false,
  };
}

/** The minimum tier aUSDC's own policy requires of any recipient. Read from chain, not assumed. */
export const ASSET_MIN_TIER = 5;

/**
 * Whether a freshly onboarded address clears the asset's transfer floor.
 *
 * Separate from credit eligibility: our lending bands start at tier 20, but an address only needs
 * tier 5 to *hold* aUSDC. A contract that clears 5 and nothing else is exactly what `CreditPool`
 * needs — it must custody the asset, never borrow against it.
 */
export function canHoldAsset(result: OnboardResult): boolean {
  return result.usable && result.tier >= ASSET_MIN_TIER;
}
