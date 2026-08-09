# PR message — feat/backend-validation-registry

Copy the Title into GitHub's title field (it otherwise auto-fills from the branch
name), and everything below the line into the description.

Title:

Backend: wire real ERC-8004 validationRequest() into the 402 flow

---

PR: feat/backend-validation-registry → main

Title: Backend: wire real ERC-8004 validationRequest() into the 402 flow

## What

Phase 3b — the backend half of the Validation Registry wiring. Phase 3 (contracts,
merged in #9) made `JobEscrow.createJob()` hard-gate on `validationRequestHash`, but the
backend still sent `requestHash: zeroHash` — a deliberate Phase 5 placeholder that would
now make every `createJob()` call fail. This closes that gap.

- **New `lib/validationRegistry.ts`** — mirrors `lib/jobEscrow.ts`'s structure exactly:
  a minimal ABI fragment (just `validationRequest`, the one call this module makes — same
  "only the calls actually made" discipline as the contract-side `IValidationRegistry.sol`,
  which deliberately excludes it since `JobEscrow` itself never calls it), and one exported
  function, `registerValidationRequest()`, that simulates, writes, and waits for the
  transaction to mine before returning.
- **`lib/x402.ts`**'s `!jobIdHeader` branch (the 402 response) now generates a fresh hash
  and registers it for real before responding, instead of sending `zeroHash`. A
  registration failure returns a clean 500 rather than silently falling back to a fake
  hash.
- **No buyer-side changes** — `agent.mts` already forwarded `quote.requestHash` verbatim
  into `createJob()`.

## Why

- **Reuses `SELLER_PRIVATE_KEY` directly, no new key or approval step.** The real
  registry's `validationRequest()` requires the caller to be `agentId`'s owner or an
  approved operator — confirmed via `cast wallet address` that the existing
  `SELLER_PRIVATE_KEY` (already used in `app/api/gateway/withdraw/route.ts`) derives to
  `0xBf6256299A705A56ecea00047e45976778fe0DD9`, the exact current owner of `sellerAgentId`
  851889. Considered a separate "operator" wallet via `setApprovalForAll` for key
  separation, and rejected it: ERC-721-style operator approval isn't scoped to just
  `validationRequest` — it also grants the operator the ability to transfer the agent NFT
  itself, which is a *larger* blast radius than reusing an already-trusted key, not a
  smaller one.
- **`validationRequest()` is called synchronously, waiting for the receipt**, not from a
  pre-registered pool. This is Arc testnet — free faucet gas, not real money — so the
  tradeoff is pure latency/complexity, not cost. Sync mirrors the exact
  `simulateContract → writeContract → waitForTransactionReceipt` pattern already used for
  `createJob`/`release`/`dispute`. A pool would add real new complexity (background
  refill, persistence) to solve a cost problem that doesn't exist at hackathon-scale
  traffic on free testnet gas.
- **`lib/validationRegistry.ts` owns its own wallet client** rather than taking one as a
  parameter (unlike `jobEscrow.ts`'s functions, whose real callers vary — the buyer, from
  `agent.mts`). `validationRequest()` only ever has one caller in this codebase, the
  seller, so threading a parameter that would only ever have one real value would be
  unnecessary indirection.
- **`VALIDATION_REGISTRY_ADDRESS` is a hardcoded constant**, not a new env var — same
  treatment as the already-hardcoded `ARC_TESTNET_RPC`. It's a fixed, already-deployed
  dependency, unlike `JOB_ESCROW_ADDRESS`/`SELLER_BOND_ADDRESS`, which are Tripwire's own
  contracts and don't exist yet (Phase 4).
- **Endpoint-binding stays deliberately deferred** (decided last session, given the
  timeline) — `requestHash` proves the seller registered as validatable, not which
  specific endpoint the job was quoted for. The stale comment in `x402.ts` referencing
  "Phase 3, once real" was updated to describe this as the actual remaining known
  limitation, to be documented in `plans/08-disclosures.md`.

## Audit finding, fixed (2026-08-07, same branch)

Asked to strictly audit this before considering it done, given it touches money-adjacent
infrastructure (the hash this issues gates `createJob`). Found one real reliability bug:

**Nonce race under concurrent requests.** `sellerWalletClient` is a module-scope
singleton, and this is a Next.js API route — concurrent requests are real, not
hypothetical (two buyers browsing simultaneously, an overlapping retry). Without explicit
nonce management, viem's default behavior fetches the pending nonce fresh per call; two
concurrent `writeContract` calls could read the *same* pending nonce and race. The loser
either gets rejected outright, or — worse — silently **replaces** the winner's transaction
in the mempool, leaving that request's `waitForTransactionReceipt` waiting on a hash that
will never mine. No funds are at risk here directly (`validationRequest` moves nothing),
but a request that can hang under concurrent load is exactly the kind of thing that could
visibly break a live demo.

**Fix**: attached viem's `nonceManager` (`viem/nonce`) to the seller account, which
serializes nonce assignment across concurrent calls from that one account — the
documented, purpose-built fix for exactly this scenario.

**Verified the fix actually works**, not just that it compiles: fired two genuinely
concurrent requests at two different protected routes, both succeeded with distinct
hashes (402, not 500), both confirmed on-chain via `getValidationStatus` with the same
mined timestamp, no errors in the server log.

## Pre-deploy security audit, fixed (2026-08-07, same branch)

Asked to go through every completed phase adversarially before touching Phase 4 deploy —
"we're dealing with money, need to be careful." Full results:

**`SellerBond.sol`** — clean. Never had a dedicated adversarial pass before (unlike
`JobEscrow.sol`, audited twice). Independently re-derived its core invariant
(`reserved[agentId] + pendingWithdrawal[agentId].amount <= bondBalance[agentId]`) at
every single write site rather than trusting the code comment's claim — holds. No bugs.

**`JobEscrow.sol`** — clean, re-read fresh as it stands today with all phases layered in.
Traced reentrancy exhaustively across every function: confirmed structurally safe via CEI
ordering + `onlyBuyer`/`onlyArbiter` access control + `claimTimeout`'s deliberately
permissionless design (a reentrant call into it just does what it's already supposed to
do) — not merely "safe because USDC has no hooks." Re-confirmed the concurrent-jobs bond
math and the hash-reuse fix hold under fresh scrutiny, including against a hypothetical
cross-deployment reuse trick (closed by the existing `validatorAddress == address(this)`
check). No bugs.

**Two real findings in the backend, both fixed:**

1. **`agent.mts` trusted the seller's 402 response blindly** — see the commit on this
   branch. `jobEscrowAddress` and `price` both came entirely from the remote seller
   server with no independent check. A malicious/compromised seller could name any
   address in `jobEscrowAddress`; the `approve()` call alone (before `createJob` is even
   attempted) would grant that address permission to pull the buyer's USDC directly —
   classic approve-to-scam-contract. Fixed: both values now checked against the buyer's
   own trusted sources (`JOB_ESCROW_ADDRESS` env var, per-endpoint `expectedPrice`) before
   anything is approved or spent.
2. **`/api/gateway/withdraw` had zero authentication** — predates Tripwire's own phases
   (part of the original forked repo), found by checking for `middleware.ts` (none exists
   anywhere in the project) and any auth code in the route itself (none). This endpoint
   moves real funds to a `destinationAddress` the *caller* supplies — anyone who could
   reach the server, not just the dashboard, could drain it with one POST. Fixed with a
   shared-secret bearer token (`WITHDRAW_API_KEY`) — disclosed honestly as MVP-level
   (this app has no per-user auth concept at all, it's a single-operator tool), not real
   authentication. Verified live: 401 with no key and with a wrong key, correct key passes
   through to the real business logic.

## Testing

- `npx tsc --noEmit` and `npm run lint` — both clean.
- **Verified live against the real deployed Validation Registry**, not just typechecked:
  ran the dev server with a temporary placeholder `JOB_ESCROW_ADDRESS`, hit
  `/api/premium/quote` for real, got back a real (non-zero) `requestHash`. Confirmed via
  `cast call getValidationStatus(hash)` that it round-tripped correctly — `validatorAddress`
  matched the placeholder, `agentId` matched `851889`, timestamped seconds earlier,
  unresponded as expected pre-attestation. One real Arc testnet transaction, free faucet
  gas. The placeholder address and the extra blank line it left in `.env.local` were both
  cleaned up afterward — no lasting changes outside the two committed files.
- Full end-to-end (402 → real `createJob` using this hash) stays blocked on Phase 4
  deploy providing a real `JOB_ESCROW_ADDRESS` — not a new limitation, same situation
  Phase 5's backend rewiring shipped under.
