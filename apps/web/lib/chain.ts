/**
 * Chain plumbing shared by everything that reads or waits on-chain.
 *
 * Cleanverse identifies chains by slug (`monad`), viem by object. This is the one place that
 * mapping lives, so adding a chain later is a single edit rather than a hunt.
 */

import { createPublicClient, http, type PublicClient } from "viem";
import { arbitrum, avalanche, base, bsc, mainnet, monadTestnet, polygon } from "viem/chains";

import type { Chain as CleanverseChain } from "./cleanverse/types";

/**
 * Cleanverse slug → viem chain.
 *
 * `monad` maps to **testnet** because that is our deploy target; revisit when moving to mainnet.
 * Solana, HashKey and PlatON are absent: they are not EVM chains viem models this way, and we do
 * not deploy there.
 */
const CHAINS = {
  monad: monadTestnet,
  base,
  ethereum: mainnet,
  polygon,
  arbitrum,
  avalanche,
  bsc,
} as const;

export type SupportedChain = keyof typeof CHAINS;

export function isSupportedChain(chain: string): chain is SupportedChain {
  return chain in CHAINS;
}

// One client per chain. Creating a fresh client per request leaks sockets under load.
const clients = new Map<SupportedChain, PublicClient>();

export function getPublicClient(chain: CleanverseChain): PublicClient {
  if (!isSupportedChain(chain)) {
    throw new Error(
      `No EVM client configured for chain "${chain}". Add it to lib/chain.ts if we deploy there.`,
    );
  }

  const existing = clients.get(chain);
  if (existing) return existing;

  const client = createPublicClient({
    chain: CHAINS[chain],
    // Prefer an explicit RPC when set — public endpoints rate-limit, and the demo should not
    // depend on one.
    transport: http(process.env.MONAD_RPC_URL || undefined),
  }) as PublicClient;

  clients.set(chain, client);
  return client;
}
