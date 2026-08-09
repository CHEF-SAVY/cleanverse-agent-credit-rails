/**
 * Types for the Cleanverse Cooperate API v5.6.
 *
 * Field names here follow the API's own vocabulary (snake_case on the wire, A-Pass / A-Token
 * rather than CVI / CVA) so that a reader can match any type back to a section of
 * `docs/cleanverse/api-v5.6.txt` without a translation step.
 */

/** Chains the Cooperate API accepts. Verbatim from the v5.6 supported-chain list — Arc is absent. */
export const CHAINS = [
  "solana",
  "base",
  "avalanche",
  "arbitrum",
  "ethereum",
  "polygon",
  "bsc",
  "monad",
  "hashkey",
  "platon",
] as const;

export type Chain = (typeof CHAINS)[number];

/** Every response is this envelope. `code` is `"0000"` on success — note it is a string. */
export interface ApiEnvelope<T> {
  code: string;
  message: string;
  data: T;
}

export const SUCCESS_CODE = "0000";

/** A-Pass status. 1 = Activate, 2 = Freeze. */
export enum ApassStatus {
  Active = 1,
  Frozen = 2,
}

/**
 * An A-Pass as returned by `query_apass`.
 *
 * The response is flat — there is no nested `wallets` array, despite what the shape of
 * `generate_apass`'s *request* might suggest.
 */
export interface ApassRecord {
  /** 0–99. The API returns this as a **string** (e.g. `"26"`); use {@link parseTier}. */
  tier: string;
  subTier: number;
  /** 1–2 characters. */
  group: string;
  subGroup: string;
  /** ISO-3166-1 alpha-2, derived by Cleanverse from the holder's identity documents. */
  countries: string[];
  status: ApassStatus;
  /** Unix **seconds**, not milliseconds. */
  expirationTime: number;
  /** Hash of the KYC snapshot backing this pass. Our audit trail pins draw-downs to this. */
  currentKycHash: string;
}

/**
 * `tier` arrives as a string and we have seen the docs describe it as a number. Parse
 * defensively: anything unrecognised is treated as tier 0, which fails every gate.
 */
export function parseTier(tier: string | number | null | undefined): number {
  const n = typeof tier === "number" ? tier : Number.parseInt(String(tier ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** True when the pass is active and has not expired as of `now`. */
export function isApassUsable(apass: ApassRecord, now: Date = new Date()): boolean {
  return apass.status === ApassStatus.Active && apass.expirationTime * 1000 > now.getTime();
}

/**
 * A compliance rule in the API's legacy shape.
 *
 * The on-chain CCP protocol supersedes `is_black_list` + `countries` with a single
 * `poolCountryBitmap`; the REST layer still accepts this form and converts. Fields within one
 * rule are ANDed; multiple rules on a pool are ORed.
 */
export interface ComplianceRule {
  /** 1–2 chars, or empty for "any". */
  allowed_group: string;
  allowed_sub_group: string;
  min_tier: number;
  min_sub_tier: number;
  /** When true, `countries` is a deny-list rather than an allow-list. */
  is_black_list: boolean;
  /** ISO-3166-1 alpha-2. */
  countries: string[];
}

export interface ValidatorVerifyResult {
  chain: Chain;
  contract_address: string;
  user_address: string;
  /**
   * `false` is a legitimate answer delivered over HTTP 200 — an ineligible borrower, not a
   * failure. Never surface it as an error.
   */
  valid: boolean;
}

export interface ValidatorIsRegisteredResult {
  chain: Chain;
  contract_address: string;
  registered: boolean;
}

export interface ValidatorRulesResult {
  chain: Chain;
  contract_address: string;
  rules: ComplianceRule[];
}

/** Rule mutations are on-chain writes and return a transaction hash. */
export interface TxHashResult {
  chain: Chain;
  tx_hash: string;
}

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  icon: string;
}

export interface SupportedAToken {
  origin_token: TokenInfo;
  atoken: TokenInfo;
  accesscore_address: string;
  apass_address: string;
}

export interface DepositAtokenListResult {
  chain: Chain;
  tokens: SupportedAToken[];
}

/** Result codes for `verify_apass`. Only {@link VerifyApassCode.Allowed} permits a transfer. */
export enum VerifyApassCode {
  ATokenNotFound = 1,
  NoApass = 2,
  /** The pass exists but is expired or frozen, so it cannot move this A-Token. */
  ApassCannotTransfer = 3,
  Allowed = 4,
}
