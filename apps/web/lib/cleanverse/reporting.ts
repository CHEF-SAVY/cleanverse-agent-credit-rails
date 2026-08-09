/**
 * Transaction history and Travel Rule export — the audit-ready half of the settlement story.
 *
 * Every draw-down is traceable to a specific A-Pass snapshot; this is where that trail becomes
 * something an institution can actually be handed.
 */

import { cleanverseRequest } from "./client";
import { getCleanverseConfig } from "./env";
import type { Chain } from "./types";

export interface TransactionRecord {
  tx_hash: string;
  type: string;
  symbol: string;
  amount: string;
  from: string;
  to: string;
  /** Unix seconds. */
  block_time: number;
}

export interface QueryTransactionsArgs {
  address: string;
  chain?: Chain;
  /** Origin or A-Token symbol — e.g. `usdc` or `ausdc`. */
  symbol?: string;
  /** Unix seconds. */
  startTime?: number;
  endTime?: number;
  txHash?: string;
  /** e.g. `transfer`, `deposit`, `withdraw`. */
  type?: string;
}

export async function queryTransactions(
  args: QueryTransactionsArgs,
): Promise<{ transactions: TransactionRecord[] }> {
  const { address, chain, ...filters } = args;
  return cleanverseRequest(
    "/query_txs",
    {
      chain: chain ?? getCleanverseConfig().defaultChain,
      address,
      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)),
    },
    { encrypted: false },
  );
}

/**
 * Generate a Travel Rule / transaction report for a single settlement.
 *
 * Use the withdraw `txHash` for a Travel Rule report, or the transfer `txHash` for a transaction
 * report — the latter covers A-Token and Wrapped A-Token transfers only.
 */
export async function downloadTravelRule({
  txHash,
  walletAddress,
  chain,
  customerId,
  cvRecordId,
}: {
  txHash: string;
  walletAddress: string;
  chain?: Chain;
  customerId?: string;
  cvRecordId?: string;
}): Promise<unknown> {
  return cleanverseRequest(
    "/download_travel_rule",
    {
      txHash,
      wallet: { chain: chain ?? getCleanverseConfig().defaultChain, address: walletAddress },
      ...(customerId ? { customerId } : {}),
      ...(cvRecordId ? { cvRecordId } : {}),
    },
    { encrypted: false },
  );
}
