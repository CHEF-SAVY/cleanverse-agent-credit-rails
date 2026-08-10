/**
 * Credit bands — the join between a Cleanverse compliance rule and an on-chain credit limit.
 *
 * Each band is a `CreditTierGate` contract registered with Cleanverse against one `RuleV2`.
 * `CreditLine.creditLimit()` calls `complianceVerify(gate, operator)` for each and takes the
 * highest band that passes, so this table is the single definition of "who can borrow how much".
 * The limits here must match `contracts/script/Deploy.s.sol`. (BigInt() rather than `n`
 * literals: this app targets ES2017.)
 *
 * ## Why the rules key on subTier
 *
 * Every A-Pass Cleanverse issues us comes back at **tier 50** — we do not choose it. Measured, not
 * assumed: seven passes minted across bare addresses, varied `subTier`, and full identity document
 * sets (passport / ID card / driver's licence, issued in GB, US and NG). **Every one returned
 * tier 50.** Submitting richer KYC does not move it in the sandbox.
 *
 * Keying bands on `minTier` alone would therefore make bands 1 and 2 auto-pass for everyone and
 * only band 3 discriminate, collapsing three bands into two outcomes.
 *
 * `subTier` we *do* control: it is settable at `generate_apass` and `RuleV2.minSubTier` gates on
 * it. Fields inside one `RuleV2` are ANDed, so each band demands a real KYC floor (`minTier`)
 * **and** an operator classification (`minSubTier`).
 *
 * ⚠️ Be precise about this in any writeup: `minTier` is Cleanverse's KYC signal; `subTier` is a
 * classification *we submit*. The gate is genuinely enforced by Cleanverse's on-chain rule engine
 * either way, but the subTier number is ours, not verification output. If Cleanverse issues varied
 * real tiers later, raise `minTier` per band and this asymmetry disappears.
 *
 * ## `countries` is the genuinely KYC-derived lever
 *
 * The same experiment showed `countries` **does** vary and is derived from the submitted
 * documents — a GB passport yields `["GB"]`, a Nigerian pair yields `["NG"]`. Unlike subTier, we
 * do not choose it: it comes out of the identity documents.
 *
 * So the honest demonstration of identity-gated lending is a **country rule**, not a tier rule:
 * add `countries` + `is_black_list` to a band's rule and an operator's credit changes because of
 * what their passport says. `ComplianceRule` already carries both fields; nothing further is
 * needed to use them.
 */

import type { ComplianceRule } from "./types";

/** The tier every A-Pass we have been issued arrives at. Observed, not documented — recheck it. */
export const OBSERVED_DEFAULT_TIER = 50;

/**
 * KYC floor required of every band.
 *
 * Below the observed default so a pass issued at a lower tier still qualifies for band 1 rather
 * than silently losing all credit — this must not be tuned to exactly what we happen to see.
 */
export const BAND_MIN_TIER = 20;

export interface CreditBand {
  /** Matches the `label` passed to the `CreditTierGate` constructor. */
  label: string;
  /** Credit limit in asset units (aUSDC, 6 decimals). Must match Deploy.s.sol. */
  limit: bigint;
  /** Submitted as `subTier` when onboarding an operator into this band. */
  subTier: number;
  description: string;
  rule: ComplianceRule;
}

function rule(minSubTier: number): ComplianceRule {
  return {
    allowed_group: "",
    allowed_sub_group: "",
    min_tier: BAND_MIN_TIER,
    min_sub_tier: minSubTier,
    is_black_list: false,
    countries: [],
  };
}

/**
 * Ordered low to high. Order is presentational only — `creditLimit()` takes the highest passing
 * band regardless of array position.
 */
export const CREDIT_BANDS: readonly CreditBand[] = [
  {
    label: "band-1",
    limit: BigInt(500_000_000), // 500 aUSDC
    subTier: 10,
    description: "Verified operator",
    rule: rule(10),
  },
  {
    label: "band-2",
    limit: BigInt(2_500_000_000), // 2,500 aUSDC
    subTier: 40,
    description: "Enhanced verification",
    rule: rule(40),
  },
  {
    label: "band-3",
    limit: BigInt(10_000_000_000), // 10,000 aUSDC
    subTier: 80,
    description: "Institutional",
    rule: rule(80),
  },
] as const;

export type BandLabel = (typeof CREDIT_BANDS)[number]["label"];

export function getBand(label: string): CreditBand | undefined {
  return CREDIT_BANDS.find((b) => b.label === label);
}

/**
 * The highest band an A-Pass's attributes would satisfy, or `null` for none.
 *
 * **Advisory only.** The authoritative answer is `complianceVerify` inside the borrowing
 * transaction; this exists so the dashboard can explain *why* a limit is what it is without
 * pretending to decide it. It deliberately mirrors the AND semantics of a single `RuleV2` rather
 * than reimplementing anything cleverer.
 */
export function highestQualifyingBand(apass: {
  tier: number;
  subTier: number;
}): CreditBand | null {
  let best: CreditBand | null = null;
  for (const band of CREDIT_BANDS) {
    const passes = apass.tier >= band.rule.min_tier && apass.subTier >= band.rule.min_sub_tier;
    if (passes && (!best || band.limit > best.limit)) best = band;
  }
  return best;
}
