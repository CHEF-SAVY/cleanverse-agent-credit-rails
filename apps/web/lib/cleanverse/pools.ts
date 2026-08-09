/**
 * Registering credit bands as Cleanverse compliance pools.
 *
 * This is the step that makes the identity gate real. Until a `CreditTierGate` is registered with
 * a rule, `complianceVerify(gate, operator)` has nothing to answer and the band grants no credit.
 *
 * Two properties are load-bearing:
 *
 *   - **Idempotent.** Checks `is_register` before writing, so re-running after a partial failure
 *     skips what already succeeded instead of erroring or double-registering.
 *   - **Serial.** Rule mutations are on-chain writes, and v5.6 warns to let one confirm before
 *     issuing another against the same pool. Bands are registered one at a time, never in
 *     parallel — `Promise.all` over these would be a correctness bug, not an optimisation.
 */

import type { Hex } from "viem";

import { CREDIT_BANDS, type CreditBand } from "./bands";
import { CleanverseApiError } from "./client";
import { getCleanverseConfig } from "./env";
import type { SignatureVariant } from "./signature";
import type { Chain } from "./types";
import { isPoolRegistered, registerPool, setPoolRule } from "./validator";

export interface BandAddresses {
  /** Gate contract address per band label, e.g. `{ "band-1": "0x…" }`. */
  [label: string]: string;
}

export type RegistrationOutcome =
  | { label: string; address: string; status: "already-registered" }
  | { label: string; address: string; status: "registered"; txHash: string }
  | { label: string; address: string; status: "failed"; error: string; code?: string };

/**
 * Register one band, skipping the write if Cleanverse already knows the address.
 *
 * The owner signature is checked against the gate's `Ownable.owner()`, so `ownerPrivateKey` must
 * be the deployer that owns it.
 */
export async function registerBand({
  band,
  address,
  ownerPrivateKey,
  chain,
  variant,
}: {
  band: CreditBand;
  address: string;
  ownerPrivateKey: Hex;
  chain?: Chain;
  variant?: SignatureVariant;
}): Promise<RegistrationOutcome> {
  const resolvedChain = chain ?? getCleanverseConfig().defaultChain;

  try {
    const existing = await isPoolRegistered({ contractAddress: address, chain: resolvedChain });
    if (existing.registered) {
      return { label: band.label, address, status: "already-registered" };
    }

    const result = await registerPool({
      contractAddress: address,
      rule: band.rule,
      ownerPrivateKey,
      chain: resolvedChain,
      variant,
    });

    return { label: band.label, address, status: "registered", txHash: result.tx_hash };
  } catch (error) {
    return {
      label: band.label,
      address,
      status: "failed",
      error: error instanceof Error ? error.message : "registration failed",
      code: error instanceof CleanverseApiError ? error.code : undefined,
    };
  }
}

/**
 * Register every band, in sequence.
 *
 * Does not stop at the first failure: one band failing to register is a partial outcome worth
 * reporting in full, and the caller can re-run to retry only what did not land.
 */
export async function registerAllBands({
  addresses,
  ownerPrivateKey,
  chain,
  variant,
}: {
  addresses: BandAddresses;
  ownerPrivateKey: Hex;
  chain?: Chain;
  variant?: SignatureVariant;
}): Promise<RegistrationOutcome[]> {
  const outcomes: RegistrationOutcome[] = [];

  for (const band of CREDIT_BANDS) {
    const address = addresses[band.label];
    if (!address) {
      outcomes.push({
        label: band.label,
        address: "",
        status: "failed",
        error: `No address configured for ${band.label}. Set GATE_${band.label.toUpperCase().replace("-", "_")}.`,
      });
      continue;
    }
    // Sequential on purpose — see the module note on serialising rule mutations.
    outcomes.push(await registerBand({ band, address, ownerPrivateKey, chain, variant }));
  }

  return outcomes;
}

/** Band gate addresses from the environment, for the routes and scripts that need them. */
export function bandAddressesFromEnv(): BandAddresses {
  const addresses: BandAddresses = {};
  for (const band of CREDIT_BANDS) {
    const key = `GATE_${band.label.toUpperCase().replace("-", "_")}`;
    const value = process.env[key];
    if (value) addresses[band.label] = value;
  }
  return addresses;
}

/**
 * Retune a band's rule after registration — the live demo beat.
 *
 * Separate from {@link registerBand} because the failure modes differ: registration is one-shot
 * setup, while this is an ongoing lending-policy change that someone will run against a pool
 * carrying real credit lines.
 */
export async function retuneBand({
  band,
  address,
  chain,
}: {
  band: CreditBand;
  address: string;
  chain?: Chain;
}): Promise<{ txHash: string }> {
  const result = await setPoolRule({ contractAddress: address, rule: band.rule, chain });
  return { txHash: result.tx_hash };
}
