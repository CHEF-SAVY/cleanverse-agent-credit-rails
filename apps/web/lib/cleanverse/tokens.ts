/**
 * A-Token discovery, deposit addresses, and the testnet faucet.
 *
 * The credit pool is denominated in a real A-Token (aUSDC) rather than a mock, which is what makes
 * the compliance story end-to-end: the same token that carries the transfer rules carries the loan.
 */

import { cleanverseRequest } from "./client";
import { getCleanverseConfig } from "./env";
import type { Chain, DepositAtokenListResult, SupportedAToken } from "./types";

/**
 * Every A-Token supported on a chain, paired with its origin token.
 *
 * This is the authoritative source for `ASSET_ADDRESS` — the contracts read it from env precisely
 * so that an unverified constant can't silently drift from what Cleanverse actually supports.
 *
 * ⚠️ The response also carries `accesscore_address` and `apass_address`. Neither is the CCP
 * compliance validator — verified on Monad 2026-08-09, both are live ERC-1967 proxies that revert
 * on `complianceVerify`, `isRegistered` and `getRulesV2`. Do not wire `CCP_VALIDATOR_ADDRESS` to
 * either of them.
 */
export async function listSupportedATokens(chain?: Chain): Promise<DepositAtokenListResult> {
  return cleanverseRequest<DepositAtokenListResult>(
    "/query_deposit_atoken_list",
    { chain: chain ?? getCleanverseConfig().defaultChain },
    { encrypted: false },
  );
}

/** Find one A-Token by symbol (case-insensitive), or `null` if the chain doesn't carry it. */
export async function findAToken(
  symbol: string,
  chain?: Chain,
): Promise<SupportedAToken | null> {
  const { tokens } = await listSupportedATokens(chain);
  const wanted = symbol.toLowerCase();
  return (
    tokens.find(
      (t) =>
        t.atoken.symbol.toLowerCase() === wanted || t.origin_token.symbol.toLowerCase() === wanted,
    ) ?? null
  );
}

/**
 * The deposit address for a wallet.
 *
 * Native tokens sent here are auto-converted to the corresponding A-Token — but only from
 * whitelisted senders; anything else is forwarded on to the linked wallet uncoverted.
 */
export async function queryDepositAddress(
  walletAddress: string,
  chain?: Chain,
): Promise<{ chain: Chain; address: string; depositAddress: string }> {
  return cleanverseRequest(
    "/query_deposit_address",
    { chain: chain ?? getCleanverseConfig().defaultChain, address: walletAddress },
    { encrypted: false },
  );
}

/**
 * Request test tokens to a **deposit address** (not a wallet address).
 *
 * Open to all three role tiers, which makes it the simplest route to testnet aUSDC — likely
 * removing our dependence on the external Circle faucet.
 */
export async function requestFaucet({
  symbol,
  depositAddress,
  amount,
  chain,
}: {
  symbol: string;
  depositAddress: string;
  /** Decimal string, e.g. `"100"`. */
  amount: string;
  chain?: Chain;
}): Promise<unknown> {
  return cleanverseRequest(
    "/faucet",
    { chain: chain ?? getCleanverseConfig().defaultChain, symbol, depositAddress, amount },
    { encrypted: false },
  );
}
