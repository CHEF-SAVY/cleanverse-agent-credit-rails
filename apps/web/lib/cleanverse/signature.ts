/**
 * Owner signatures for `validator/grant` and `validator/register`.
 *
 * Cleanverse checks the signature against the subject contract's `Ownable.owner()`, which is why
 * `CreditPool` and `CreditTierGate` both expose `owner()`.
 *
 * ⚠️ The two sources disagree on what is signed, and we cannot resolve it without a live
 * Issue-Member call:
 *
 *   - API v5.6 (`/validator/register`): "EIP-191 signature over chain + contract_address"
 *   - CCP validator guide: "Signature Rule: keccak256(chain + contract_address), lowercase hex
 *     concatenation"
 *
 * The first reads as `personal_sign("monad0xabc…")`; the second as signing the keccak hash of that
 * string. Both variants are implemented and {@link signPoolOwnership} defaults to the raw-message
 * form, matching the API doc that actually governs this endpoint. If registration comes back
 * `0001 Invalid contract owner signature`, try `variant: "keccak"` before suspecting the key.
 */

import { keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Chain } from "./types";

export type SignatureVariant = "message" | "keccak";

/**
 * Build the payload: lowercase chain slug immediately followed by the lowercase hex address, with
 * no separator — e.g. `monad0x742d35cc6634c0532925a3b844bc9e7595f0beb0`.
 */
export function poolOwnershipPayload(chain: Chain, contractAddress: string): string {
  return `${chain.toLowerCase()}${contractAddress.toLowerCase()}`;
}

export interface SignPoolOwnershipArgs {
  chain: Chain;
  contractAddress: string;
  /** The contract owner's key. Server-side only. */
  ownerPrivateKey: Hex;
  variant?: SignatureVariant;
}

export async function signPoolOwnership({
  chain,
  contractAddress,
  ownerPrivateKey,
  variant = "message",
}: SignPoolOwnershipArgs): Promise<Hex> {
  const account = privateKeyToAccount(ownerPrivateKey);
  const payload = poolOwnershipPayload(chain, contractAddress);

  // Both variants are EIP-191 personal_sign; they differ only in what gets wrapped.
  return variant === "keccak"
    ? account.signMessage({ message: { raw: toBytes(keccak256(toBytes(payload))) } })
    : account.signMessage({ message: payload });
}
