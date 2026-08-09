/**
 * Validator Compliance — the identity gate.
 *
 * Our credit pool registers as a compliance pool, and the rule that decides who may borrow
 * (`min_tier`, `allowed_group`, country allow/deny) lives here rather than in our contracts.
 * Tightening lending standards is a rule change on Cleanverse, not a redeploy on our side.
 *
 * Everything in this module except the reads requires **Issue Member** role.
 */

import { cleanverseRequest, CleanverseApiError } from "./client";
import { getCleanverseConfig } from "./env";
import { signPoolOwnership, type SignatureVariant } from "./signature";
import type {
  Chain,
  ComplianceRule,
  TxHashResult,
  ValidatorIsRegisteredResult,
  ValidatorRulesResult,
  ValidatorVerifyResult,
} from "./types";
import type { Hex } from "viem";

interface PoolRef {
  contractAddress: string;
  chain?: Chain;
}

function chainOf(chain?: Chain): Chain {
  return chain ?? getCleanverseConfig().defaultChain;
}

// ---------------------------------------------------------------------------
// Reads — plain JSON, no encryption
// ---------------------------------------------------------------------------

export async function isPoolRegistered({
  contractAddress,
  chain,
}: PoolRef): Promise<ValidatorIsRegisteredResult> {
  return cleanverseRequest<ValidatorIsRegisteredResult>(
    "/validator/is_register",
    { chain: chainOf(chain), contract_address: contractAddress },
    { encrypted: false },
  );
}

export async function getPoolRules({
  contractAddress,
  chain,
}: PoolRef): Promise<ValidatorRulesResult> {
  return cleanverseRequest<ValidatorRulesResult>(
    "/validator/rules",
    { chain: chainOf(chain), contract_address: contractAddress },
    { encrypted: false },
  );
}

export async function isPoolPaused({
  contractAddress,
  chain,
}: PoolRef): Promise<{ chain: Chain; contract_address: string; paused: boolean }> {
  return cleanverseRequest(
    "/validator/is_paused",
    { chain: chainOf(chain), contract_address: contractAddress },
    { encrypted: false },
  );
}

/**
 * The gate: does `userAddress` satisfy the pool's compliance rules?
 *
 * `valid: false` arrives over HTTP 200 and means "not eligible" — a normal answer, not an error.
 * Use {@link canBorrow} when you want that flattened to a boolean with the failure modes folded in
 * safely.
 */
export async function verifyCompliance({
  contractAddress,
  userAddress,
  chain,
}: PoolRef & { userAddress: string }): Promise<ValidatorVerifyResult> {
  return cleanverseRequest<ValidatorVerifyResult>(
    "/validator/verify",
    {
      chain: chainOf(chain),
      contract_address: contractAddress,
      user_address: userAddress,
    },
    // Retried: this read backs the dashboard, and a transient timeout would otherwise be
    // indistinguishable from a genuine denial.
    { encrypted: false, retries: 2 },
  );
}

/**
 * {@link verifyCompliance} reduced to a single boolean that **fails closed**.
 *
 * A paused pool answers `12027` in place of a verdict, and an outage answers nothing at all.
 * Neither may be read as approval: an outage must deny credit, never grant it. This mirrors
 * `CreditLine._passesGate`, which swallows validator reverts into `false` on-chain.
 */
export async function canBorrow(
  args: PoolRef & { userAddress: string },
): Promise<{ eligible: boolean; reason?: string }> {
  try {
    const result = await verifyCompliance(args);
    return result.valid
      ? { eligible: true }
      : { eligible: false, reason: "Wallet does not satisfy the pool's compliance rules." };
  } catch (error) {
    if (error instanceof CleanverseApiError && error.isPoolPaused) {
      return { eligible: false, reason: "The compliance pool is paused; verification unavailable." };
    }
    return {
      eligible: false,
      reason:
        error instanceof Error
          ? `Compliance check unavailable: ${error.message}`
          : "Compliance check unavailable.",
    };
  }
}

// ---------------------------------------------------------------------------
// Writes — encrypted, Issue Member, owner-signed
// ---------------------------------------------------------------------------

/**
 * Grant REGISTER_ROLE to an account.
 *
 * Only needed for the *factory* mode, where one registrar batch-manages many pools. The
 * single-contract mode we use for `CreditTierGate` does not require it — Cleanverse's own guide
 * names our exact case there ("Lending protocols: verify borrower CVI to filter compliant
 * borrowers").
 *
 * ⚠️ The path is `/validator/grant`. `/validator/apply`, which circulated in the group chat,
 * does not exist in the API docs or either CCP guide.
 */
export async function grantRegistrarRole({
  address,
  ownerPrivateKey,
  chain,
  variant,
}: {
  address: string;
  ownerPrivateKey: Hex;
  chain?: Chain;
  variant?: SignatureVariant;
}): Promise<{ chain: Chain; address: string; tx_hash: string }> {
  const resolved = chainOf(chain);
  const owner_signature = await signPoolOwnership({
    chain: resolved,
    contractAddress: address,
    ownerPrivateKey,
    variant,
  });

  return cleanverseRequest(
    "/validator/grant",
    { chain: resolved, address, owner_signature },
    { encrypted: true },
  );
}

/**
 * Register a contract as a compliance pool and set its initial rule.
 *
 * The signature is checked against the contract's `Ownable.owner()`, so `ownerPrivateKey` must be
 * the deployer key that owns `contractAddress`.
 */
export async function registerPool({
  contractAddress,
  rule,
  ownerPrivateKey,
  chain,
  variant,
}: PoolRef & {
  rule: ComplianceRule;
  ownerPrivateKey: Hex;
  variant?: SignatureVariant;
}): Promise<TxHashResult & { contract_address: string }> {
  const resolved = chainOf(chain);
  const owner_signature = await signPoolOwnership({
    chain: resolved,
    contractAddress,
    ownerPrivateKey,
    variant,
  });

  return cleanverseRequest(
    "/validator/register",
    { chain: resolved, contract_address: contractAddress, rule, owner_signature },
    { encrypted: true },
  );
}

/**
 * Replace a pool's rule set.
 *
 * ⚠️ Rule mutations are on-chain writes. The docs warn to wait for one to confirm before issuing
 * another against the same pool — callers must serialise these, which is why nothing here fires
 * them in parallel.
 */
export async function setPoolRule({
  contractAddress,
  rule,
  chain,
}: PoolRef & { rule: ComplianceRule }): Promise<TxHashResult> {
  return cleanverseRequest(
    "/validator/set_rule",
    { chain: chainOf(chain), contract_address: contractAddress, rule },
    { encrypted: true },
  );
}

/** Append a rule. Multiple rules on a pool are ORed, so this widens admission. */
export async function addPoolRule({
  contractAddress,
  rule,
  chain,
}: PoolRef & { rule: ComplianceRule }): Promise<TxHashResult> {
  return cleanverseRequest(
    "/validator/add_rule",
    { chain: chainOf(chain), contract_address: contractAddress, rule },
    { encrypted: true },
  );
}

export async function removePoolRule({
  contractAddress,
  index,
  chain,
}: PoolRef & { index: number }): Promise<TxHashResult> {
  return cleanverseRequest(
    "/validator/remove_rule",
    { chain: chainOf(chain), contract_address: contractAddress, index },
    { encrypted: true },
  );
}

/** Pause or unpause a pool. While paused, `verify` returns `12027` instead of a verdict. */
export async function setPoolPaused({
  contractAddress,
  paused,
  chain,
}: PoolRef & { paused: boolean }): Promise<TxHashResult & { paused: boolean }> {
  return cleanverseRequest(
    "/validator/set_paused",
    { chain: chainOf(chain), contract_address: contractAddress, paused },
    { encrypted: true },
  );
}
