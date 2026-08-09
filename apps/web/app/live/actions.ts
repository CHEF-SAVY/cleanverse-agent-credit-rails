"use server";

/**
 * The deliberately narrow write surface used by the live demo.
 *
 * The general-purpose admin endpoint remains protected by CLEANVERSE_ADMIN_KEY. This action only
 * exposes the two reversible mutations the demo needs: limit band-2 to GB, or restore its checked-
 * in default. Callers cannot choose a band, country, or arbitrary rule.
 */

import {
  bandAddressesFromEnv,
  getBand,
  getPoolRules,
  resetBandRule,
  restrictBandByCountry,
  withCountryRule,
  type ComplianceRule,
} from "@/lib/cleanverse";

export type DemoPolicyState = "default" | "restricted" | "custom" | "unavailable";

export interface DemoPolicySnapshot {
  state: DemoPolicyState;
  message: string;
}

export interface DemoRuleChangeResult extends DemoPolicySnapshot {
  ok: boolean;
  confirmed?: boolean;
  txHash?: string;
}

const DEMO_BAND = "band-2";
const DEMO_COUNTRIES = ["GB"];

function rulesEqual(left: ComplianceRule, right: ComplianceRule): boolean {
  return (
    left.allowed_group === right.allowed_group &&
    left.allowed_sub_group === right.allowed_sub_group &&
    left.min_tier === right.min_tier &&
    left.min_sub_tier === right.min_sub_tier &&
    left.is_black_list === right.is_black_list &&
    left.countries.length === right.countries.length &&
    left.countries.every((country, index) => country === right.countries[index])
  );
}

function classifyRules(rules: ComplianceRule[] | null): DemoPolicyState {
  const band = getBand(DEMO_BAND);
  if (!band || !rules) return "unavailable";
  if (rules.length !== 1) return "custom";
  if (rulesEqual(rules[0], band.rule)) return "default";

  const restricted = withCountryRule(band, DEMO_COUNTRIES, "allow-only");
  return rulesEqual(rules[0], restricted) ? "restricted" : "custom";
}

function snapshot(state: DemoPolicyState): DemoPolicySnapshot {
  switch (state) {
    case "default":
      return { state, message: "Band-2 is using its default tier and classification rule." };
    case "restricted":
      return { state, message: "Band-2 currently allows GB identities only." };
    case "custom":
      return { state, message: "Band-2 has a custom live rule. Reset restores the checked-in default." };
    case "unavailable":
      return { state, message: "The current band-2 rule could not be read." };
  }
}

export async function inspectDemoPolicy(): Promise<DemoPolicySnapshot> {
  const band = getBand(DEMO_BAND);
  const address = band ? bandAddressesFromEnv()[band.label] : undefined;
  if (!address) return snapshot("unavailable");

  try {
    const { rules } = await getPoolRules({ contractAddress: address });
    return snapshot(classifyRules(rules));
  } catch {
    return snapshot("unavailable");
  }
}

export async function changeDemoPolicy(
  action: "restrict" | "reset",
): Promise<DemoRuleChangeResult> {
  // An unset admin key disables every policy-changing surface, including this demo proxy.
  if (!process.env.CLEANVERSE_ADMIN_KEY) {
    return {
      ok: false,
      ...snapshot("unavailable"),
      message: "Live policy controls are not configured on this server.",
    };
  }

  if (action !== "restrict" && action !== "reset") {
    return { ok: false, ...snapshot("unavailable"), message: "Unknown demo action." };
  }

  try {
    const result =
      action === "restrict"
        ? await restrictBandByCountry({
            label: DEMO_BAND,
            countries: DEMO_COUNTRIES,
            mode: "allow-only",
          })
        : await resetBandRule({ label: DEMO_BAND });

    const state = classifyRules(result.rulesAfter);
    return {
      ok: true,
      confirmed: result.confirmed,
      txHash: result.txHash,
      ...snapshot(state),
      message: result.note,
    };
  } catch (error) {
    const current = await inspectDemoPolicy();
    return {
      ok: false,
      ...current,
      message: error instanceof Error ? error.message : "The rule change failed.",
    };
  }
}
