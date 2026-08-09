/**
 * Why an operator does or does not qualify for credit — per band, with a reason.
 *
 * "Not eligible" is a **success state** in this product, not an error: an operator who misses a
 * band should be told which one and by how much, not shown a red toast. So every band comes back
 * with a verdict, a stable machine code, a human sentence, and — where we can compute it — the
 * exact shortfall.
 *
 * ## The verdict and the reason come from different places, on purpose
 *
 * The **verdict** is Cleanverse's: `validator/verify` against each registered gate. We never
 * decide it. The **reason** is derived locally by comparing the A-Pass attributes to the band's
 * rule, purely to explain a decision someone else made.
 *
 * Those two can disagree — a rule may have changed between the read and the verify, or Cleanverse
 * may weigh something we cannot see. When they do, we report `UNEXPLAINED` rather than inventing a
 * story. Never let the local explanation override the remote verdict.
 */

import { queryApass } from "./apass";
import { CREDIT_BANDS, type CreditBand } from "./bands";
import { bandAddressesFromEnv } from "./pools";
import { isApassUsable, parseTier, ApassStatus, type ApassRecord, type Chain } from "./types";
import { verifyCompliance } from "./validator";

/** Stable codes. Branch on these; the `message` is for humans and may be reworded freely. */
export enum EligibilityCode {
  Qualified = "QUALIFIED",
  NotOnboarded = "NOT_ONBOARDED",
  ApassFrozen = "APASS_FROZEN",
  ApassExpired = "APASS_EXPIRED",
  TierTooLow = "TIER_TOO_LOW",
  SubTierTooLow = "SUBTIER_TOO_LOW",
  CountryNotPermitted = "COUNTRY_NOT_PERMITTED",
  GroupMismatch = "GROUP_MISMATCH",
  BandNotConfigured = "BAND_NOT_CONFIGURED",
  ValidatorUnavailable = "VALIDATOR_UNAVAILABLE",
  /** Cleanverse denied, and the A-Pass on file does not explain why. */
  Unexplained = "UNEXPLAINED",
}

export interface Shortfall {
  field: "tier" | "subTier";
  required: number;
  actual: number;
  gap: number;
}

export interface BandVerdict {
  label: string;
  description: string;
  /** Asset units (aUSDC, 6dp), as a string — JSON has no bigint. */
  limit: string;
  address: string | null;
  passed: boolean;
  code: EligibilityCode;
  message: string;
  /** Present only for a numeric miss we can quantify. */
  shortfall?: Shortfall;
  requirement: { minTier: number; minSubTier: number };
}

export interface EligibilityReport {
  address: string;
  onboarded: boolean;
  apass: {
    tier: number;
    subTier: number;
    group: string;
    countries: string[];
    status: ApassStatus;
    /** ISO-8601, easier for a UI than Unix seconds. */
    expiresAt: string;
    usable: boolean;
  } | null;
  /** Highest passing band, or null. */
  qualified: boolean;
  band: { label: string; limit: string; description: string } | null;
  /** Every band, in ascending order, so the UI can render a ladder. */
  bands: BandVerdict[];
  /** Top-level reason when nothing qualifies — the one line to show first. */
  summary: { code: EligibilityCode; message: string };
}

function requirementOf(band: CreditBand) {
  return { minTier: band.rule.min_tier, minSubTier: band.rule.min_sub_tier };
}

/**
 * Explain a denial by comparing the pass to the rule.
 *
 * Ordered by what a user should fix first, and it reports only what it can actually justify —
 * an unexplained denial stays unexplained.
 */
function explainDenial(band: CreditBand, apass: ApassRecord): Pick<BandVerdict, "code" | "message" | "shortfall"> {
  const tier = parseTier(apass.tier);
  const subTier = apass.subTier ?? 0;

  if (apass.status === ApassStatus.Frozen) {
    return { code: EligibilityCode.ApassFrozen, message: "This A-Pass is frozen, so it backs no credit." };
  }
  if (!isApassUsable(apass)) {
    return { code: EligibilityCode.ApassExpired, message: "This A-Pass has expired." };
  }
  if (tier < band.rule.min_tier) {
    return {
      code: EligibilityCode.TierTooLow,
      message: `${band.label} needs KYC tier ${band.rule.min_tier}; this pass is tier ${tier}.`,
      shortfall: { field: "tier", required: band.rule.min_tier, actual: tier, gap: band.rule.min_tier - tier },
    };
  }
  if (subTier < band.rule.min_sub_tier) {
    return {
      code: EligibilityCode.SubTierTooLow,
      message: `${band.label} needs classification ${band.rule.min_sub_tier}; this pass is ${subTier}.`,
      shortfall: {
        field: "subTier",
        required: band.rule.min_sub_tier,
        actual: subTier,
        gap: band.rule.min_sub_tier - subTier,
      },
    };
  }

  const countries = band.rule.countries;
  if (countries.length > 0) {
    const listed = apass.countries.some((c) => countries.includes(c));
    const blocked = band.rule.is_black_list ? listed : !listed;
    if (blocked) {
      return {
        code: EligibilityCode.CountryNotPermitted,
        message: band.rule.is_black_list
          ? `${band.label} excludes ${apass.countries.join(", ") || "this jurisdiction"}.`
          : `${band.label} is limited to ${countries.join(", ")}.`,
      };
    }
  }

  if (band.rule.allowed_group && apass.group !== band.rule.allowed_group) {
    return {
      code: EligibilityCode.GroupMismatch,
      message: `${band.label} is restricted to group ${band.rule.allowed_group}.`,
    };
  }

  // Everything on file says this should have passed. Say so rather than guess.
  return {
    code: EligibilityCode.Unexplained,
    message:
      `${band.label} was declined by Cleanverse, and the A-Pass on file does not explain why. ` +
      "The band's rule may have changed since this pass was read.",
  };
}

/**
 * Full eligibility report for an operator wallet.
 *
 * Bands are checked in parallel: these are reads, and `validator/verify` against one gate cannot
 * affect another. Only writes need serialising.
 */
export async function evaluateEligibility(
  address: string,
  chain?: Chain,
): Promise<EligibilityReport> {
  const apass = await queryApass(address, chain);
  const addresses = bandAddressesFromEnv();

  if (!apass) {
    return {
      address,
      onboarded: false,
      apass: null,
      qualified: false,
      band: null,
      bands: CREDIT_BANDS.map((band) => ({
        label: band.label,
        description: band.description,
        limit: band.limit.toString(),
        address: addresses[band.label] ?? null,
        passed: false,
        code: EligibilityCode.NotOnboarded,
        message: "This wallet has no A-Pass yet.",
        requirement: requirementOf(band),
      })),
      summary: {
        code: EligibilityCode.NotOnboarded,
        message: "This wallet has no A-Pass. Complete verification to be considered for credit.",
      },
    };
  }

  const bands: BandVerdict[] = await Promise.all(
    CREDIT_BANDS.map(async (band): Promise<BandVerdict> => {
      const gate = addresses[band.label] ?? null;
      const base = {
        label: band.label,
        description: band.description,
        limit: band.limit.toString(),
        address: gate,
        requirement: requirementOf(band),
      };

      if (!gate) {
        return {
          ...base,
          passed: false,
          code: EligibilityCode.BandNotConfigured,
          message: `${band.label} has no registered gate address, so it grants no credit.`,
        };
      }

      try {
        const verdict = await verifyCompliance({ contractAddress: gate, userAddress: address, chain });
        if (verdict.valid) {
          return { ...base, passed: true, code: EligibilityCode.Qualified, message: `Qualifies for ${band.label}.` };
        }
        return { ...base, passed: false, ...explainDenial(band, apass) };
      } catch (error) {
        // Fails closed, and says so — an outage must never read as approval.
        return {
          ...base,
          passed: false,
          code: EligibilityCode.ValidatorUnavailable,
          message:
            "Cleanverse could not be reached for this band, so it is treated as not qualifying. " +
            (error instanceof Error ? error.message : ""),
        };
      }
    }),
  );

  const best = bands
    .filter((b) => b.passed)
    .reduce<BandVerdict | null>((a, b) => (!a || BigInt(b.limit) > BigInt(a.limit) ? b : a), null);

  return {
    address,
    onboarded: true,
    apass: {
      tier: parseTier(apass.tier),
      subTier: apass.subTier ?? 0,
      group: apass.group ?? "",
      countries: apass.countries ?? [],
      status: apass.status,
      expiresAt: new Date(apass.expirationTime * 1000).toISOString(),
      usable: isApassUsable(apass),
    },
    qualified: Boolean(best),
    band: best ? { label: best.label, limit: best.limit, description: best.description } : null,
    bands,
    summary: best
      ? { code: EligibilityCode.Qualified, message: `Qualifies for ${best.label}.` }
      : // The lowest band's reason is the most actionable thing to show first.
        { code: bands[0].code, message: bands[0].message },
  };
}
