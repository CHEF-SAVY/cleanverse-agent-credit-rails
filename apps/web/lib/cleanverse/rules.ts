/**
 * Live rule tuning — changing who may borrow, without touching our contracts.
 *
 * This is the clearest demonstration that the lending policy is **not ours**. A band's admission
 * rule lives in Cleanverse's compliance validator; `CreditLine` only asks. Restricting a
 * jurisdiction here changes an operator's on-chain credit limit with no redeploy, no migration and
 * no code change on our side.
 *
 * ## Why country rules rather than tier rules
 *
 * `subTier` is a classification *we* submit, so gating on it is somewhat circular. `countries` is
 * derived by Cleanverse from the operator's actual identity documents — a Nigerian passport yields
 * `["NG"]` — and we cannot set it. A country restriction is therefore a real compliance decision
 * acting on real verified identity, which is the honest version of the demo.
 *
 * ## Three things this module gets deliberately right
 *
 * 1. **`set_rule`, never `add_rule`.** Multiple rules on a pool are **OR**ed, so appending a rule
 *    *widens* admission. Using `add_rule` to restrict would do the exact opposite of what it looks
 *    like, and would look like it worked.
 * 2. **Serialised per pool.** Rule mutations are on-chain writes; v5.6 warns to let one confirm
 *    before issuing another against the same pool.
 * 3. **Reversible.** Every band can be reset to its definition in `CREDIT_BANDS`, so the demo can
 *    be rehearsed and then run again.
 *
 * ## 🚨 `is_black_list: true` is not enforced on-chain
 *
 * Measured on Monad testnet 2026-08-09. Setting `is_black_list: true, countries: ["NG"]` on a band
 * succeeds, confirms on-chain, and reads back correctly from `validator/rules` — and an operator
 * whose A-Pass carries `["NG"]` **still passes**. The same band switched to
 * `is_black_list: false, countries: ["GB"]` denies that operator immediately.
 *
 * The likely cause is the CCP `RuleV2.poolCountryBitmap`, which supersedes the API's legacy
 * `is_black_list` + `countries` pair: a bitwise AND against a bitmap of permitted countries
 * expresses an allow-list naturally and a deny-list not at all.
 *
 * So: **use `allow-only`.** Deny-list mode is accepted by the API and silently does nothing,
 * which is worse than an error — it would have failed live. {@link restrictBandByCountry} defaults
 * to `allow-only` and returns a `warning` if `restrict` is used anyway.
 */

import { getPublicClient } from "../chain";
import { getBand, type CreditBand } from "./bands";
import { getCleanverseConfig } from "./env";
import { bandAddressesFromEnv } from "./pools";
import type { Chain, ComplianceRule } from "./types";
import { getPoolRules, setPoolRule } from "./validator";

/**
 * In-process serialisation, one queue per pool address.
 *
 * ⚠️ Single-instance only. Two server instances would each hold their own queue and could still
 * race. That is acceptable here — rule changes are a deliberate admin action performed by one
 * person — but a multi-instance deployment needs a shared lock (a DB row, or Redis).
 */
const queues = new Map<string, Promise<unknown>>();

function serialise<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  // Swallow the predecessor's rejection so one failure doesn't poison the queue.
  const next = previous.catch(() => undefined).then(task);
  queues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/** Structural equality for a rule. Field-by-field so key order and extra fields can't fool it. */
export function rulesEqual(left: ComplianceRule, right: ComplianceRule): boolean {
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

export type CountryMode = "restrict" | "allow-only";

/**
 * A band's rule with a country condition layered on, leaving tier requirements intact.
 *
 * Fields within one rule are ANDed, so the operator must still meet the band's classification
 * *and* satisfy the country condition.
 */
export function withCountryRule(
  band: CreditBand,
  countries: string[],
  mode: CountryMode,
): ComplianceRule {
  return {
    ...band.rule,
    is_black_list: mode === "restrict",
    countries: countries.map((c) => c.toUpperCase()),
  };
}

export interface RuleChangeResult {
  /** Set when the requested change is accepted by the API but will not take effect on-chain. */
  warning?: string;
  label: string;
  address: string;
  txHash: string;
  /** What we asked for. */
  rule: ComplianceRule;
  /** Read back from Cleanverse after the change — the authoritative state. */
  rulesAfter: ComplianceRule[] | null;
  /** False when the transaction did not confirm within the wait window. */
  confirmed: boolean;
  note: string;
}

async function applyRule(
  band: CreditBand,
  rule: ComplianceRule,
  note: string,
  chain?: Chain,
): Promise<RuleChangeResult> {
  const address = bandAddressesFromEnv()[band.label];
  if (!address) {
    throw new Error(
      `No gate address configured for ${band.label}. Deploy the gates and set GATE_* first.`,
    );
  }

  const resolvedChain = chain ?? getCleanverseConfig().defaultChain;

  return serialise(address.toLowerCase(), async () => {
    let txHash: string;
    try {
      ({ tx_hash: txHash } = await setPoolRule({
        contractAddress: address,
        rule,
        chain: resolvedChain,
      }));
    } catch (error) {
      // A rule write is not idempotent and cannot be retried blindly, but a failed *response* does
      // not mean a failed *write*: the request can be applied on-chain and the connection drop on
      // the way back. Observed in practice — a restrict reported `fetch failed` and had in fact
      // taken effect, which is the worst outcome to report wrongly in either direction.
      //
      // So ask Cleanverse what the rule actually is before deciding. If it already matches what we
      // asked for, the write landed and reporting an error would be a lie.
      const settled = await getPoolRules({ contractAddress: address, chain: resolvedChain })
        .then((r) => r.rules)
        .catch(() => null);

      if (settled && settled.length === 1 && rulesEqual(settled[0], rule)) {
        return {
          label: band.label,
          address,
          // No hash: the response carrying it never arrived. The rule is verified by read-back.
          txHash: "",
          rule,
          rulesAfter: settled,
          confirmed: true,
          note: `${note} (the response was lost in transit; the rule was confirmed by reading it back)`,
        };
      }
      throw error;
    }

    // Wait for the write to land before releasing the queue, so a follow-up mutation on this pool
    // cannot race it. A timeout is reported, not thrown: the transaction is already submitted and
    // will very likely confirm — claiming failure would be wrong.
    let confirmed = false;
    try {
      const receipt = await getPublicClient(resolvedChain).waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
        timeout: 60_000,
      });
      confirmed = receipt.status === "success";
    } catch {
      confirmed = false;
    }

    const rulesAfter = await getPoolRules({ contractAddress: address, chain: resolvedChain })
      .then((r) => r.rules)
      .catch(() => null);

    return {
      label: band.label,
      address,
      txHash,
      rule,
      rulesAfter,
      confirmed,
      note: confirmed
        ? note
        : `${note} (transaction submitted but not confirmed within 60s — it may still land)`,
    };
  });
}

/** Apply a country restriction to a band. The headline demo action. */
export async function restrictBandByCountry({
  label,
  countries,
  mode = "allow-only",
  chain,
}: {
  label: string;
  countries: string[];
  mode?: CountryMode;
  chain?: Chain;
}): Promise<RuleChangeResult> {
  const band = getBand(label);
  if (!band) throw new Error(`Unknown band "${label}".`);
  if (countries.length === 0) throw new Error("At least one country is required.");

  const rule = withCountryRule(band, countries, mode);
  const list = rule.countries.join(", ");
  const result = await applyRule(
    band,
    rule,
    mode === "restrict"
      ? `${band.label} now excludes ${list}.`
      : `${band.label} is now limited to ${list}.`,
    chain,
  );

  if (mode === "restrict") {
    result.warning =
      "Deny-list mode (is_black_list: true) is accepted by the API but is NOT enforced by the " +
      "on-chain validator — verified on Monad. This rule will not actually restrict anyone. " +
      'Use mode "allow-only" instead.';
  }
  return result;
}

/** Restore a band to its defined rule — how the demo is rewound. */
export async function resetBandRule({
  label,
  chain,
}: {
  label: string;
  chain?: Chain;
}): Promise<RuleChangeResult> {
  const band = getBand(label);
  if (!band) throw new Error(`Unknown band "${label}".`);
  return applyRule(band, band.rule, `${band.label} reset to its default rule.`, chain);
}

/** Set an arbitrary rule. The escape hatch; the two helpers above cover the demo. */
export async function setBandRule({
  label,
  rule,
  chain,
}: {
  label: string;
  rule: ComplianceRule;
  chain?: Chain;
}): Promise<RuleChangeResult> {
  const band = getBand(label);
  if (!band) throw new Error(`Unknown band "${label}".`);
  return applyRule(band, rule, `${band.label} rule updated.`, chain);
}
