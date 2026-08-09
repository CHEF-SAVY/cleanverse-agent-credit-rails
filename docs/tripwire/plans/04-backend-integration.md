# 4. Backend integration (forked `arc-nanopayments`)

Status: **implemented** (2026-08-03, `feat/backend-seller-escrow-rewire` commit `5b83893`,
not yet pushed). Re-verified directly against the cloned fork twice before writing anything
(2026-07-26 during Phase 0 research, again 2026-08-03 immediately before implementing —
`agent.mts`, `lib/x402.ts`, `quote/route.ts`, `withdraw/route.ts` all re-read in full both
times, no discrepancies either time). Full detail on what shipped vs. what's below is in
`plans/06-build-sequence.md`'s Phase 5 entry — this file remains the design rationale, that
file is the up-to-date implementation record.

## Principle

This is a rewiring job on the existing TypeScript/Node fork, not a new service. The HTTP 402
request/response shape doesn't change; what changes is what happens on either side of it.

## What the fork actually is (confirmed by reading the cloned code, 2026-07-26)

- **Buyer** (`agent.mts`, 296 lines, read in full): **a scripted Gateway payment loop, not an
  LLM agent.** The README and Arc docs describe a LangChain + DeepAgents agent with an
  optional-OpenAI "mock mode," and `langchain`/`deepagents`/`@langchain/openai` are all in
  `package.json` — but no source file imports any of them. The repo is one squashed initial
  commit (public export of an internal repo; README even references a different origin repo
  name), and the LLM version of the agent evidently didn't ship. What the shipped script
  does: funds an ephemeral wallet from `BUYER_PRIVATE_KEY` (gas + USDC), deposits into
  Gateway, then `gateway.pay()`s the four endpoints round-robin at 1 tx/sec
  (`agent.mts:268`), with auto-redeposit and a `--limit` spending cap.
  **Consequences:** (a) no API key is needed for anything in the baseline; (b) the track's
  "decision logic tied to real signals" comes from *our* rewiring (check delivery →
  `release()`/`dispute()`), and an optional LLM judgment layer is our own addition later —
  free-tier Groq preferred per [`06-build-sequence.md`](06-build-sequence.md); (c) for escrow
  jobs the ephemeral-wallet dance is unnecessary — the funder wallet can call `createJob()`
  directly.
- **Seller** (`lib/x402.ts:70-192`, read in full, matches the original research): the
  `withGateway(handler, price, endpoint)` wrapper returns 402 with a base64
  `PAYMENT-REQUIRED` header when no `payment-signature` header is present, otherwise
  `facilitator.verify()` → `facilitator.settle()` → inserts into Supabase `payment_events` →
  runs the real handler and attaches a `PAYMENT-RESPONSE` header. Four routes (`quote`,
  `dataset`, `compute`, `agent-task`; $0.0003–$0.03). **Supabase is a hard dependency**
  (service-role insert per payment + Realtime dashboard). Dashboard login is hardcoded
  (`admin@example.com` / `123456`, local dev only).
- **Wallets**: `npm run generate-wallets` writes `SELLER_ADDRESS`/`SELLER_PRIVATE_KEY`/
  `BUYER_ADDRESS`/`BUYER_PRIVATE_KEY` into `.env.local` (not `.env` as earlier notes said).
  Supabase needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`.
- **`proxy.ts` — question closed:** it's only dashboard session-cookie auth middleware
  (redirects between `/` and `/dashboard`); it never touches the 402 flow.

**Rewiring consequence:** the seller's Supabase event-recording should be kept working, not
ripped out — when we swap `facilitator.settle()` for the escrow flow, record job lifecycle
events (created/released/disputed) to the same store so the existing realtime dashboard keeps
functioning. That makes the dashboard a free demo asset instead of a casualty.

## Buyer (`agent.mts`) — implemented, two departures from the steps below

Replaced the current single opaque `gateway.pay()` call — that SDK method can't be intercepted
mid-flow — with:

1. Unauthenticated GET → seller returns 402 with
   `{price, sellerAgentId, requestHash, jobEscrowAddress}`.
2. `usdc.approve(jobEscrowAddress, amount)`.
3. `JobEscrow.createJob(sellerAgentId, amount, deadline, requestHash)`.
4. Retry the request, presenting `jobId`.
5. Check the response is non-empty and matches what was requested. **For a first pass, "good
   response" just means valid + non-empty + matching** — tighter validation is an explicit
   stretch goal ([`06-build-sequence.md`](06-build-sequence.md) Phase 7), not MVP.
6. `release(jobId)` if good, `dispute(jobId, evidenceHash)` if not.

Two things beyond this literal sequence, agreed before implementing (full rationale in
`06-build-sequence.md` Phase 5): the ephemeral-wallet funding step this list never mentioned
(inherited from the old Gateway flow) was dropped entirely — consequence (c) above already
called it unnecessary — and the old infinite per-endpoint loop became a single job per run
plus a `--dispute` CLI flag, to match the demo script's two-discrete-runs shape rather than a
continuous spend loop.

## Seller (`lib/x402.ts`'s `withGateway()`) — implemented, requestHash deferred to Phase 3

Replaced the `facilitator.settle()` call with:

1. On an unauthenticated request: return the 402 payload above. **Not yet calling the real
   `validationRequest()`** — `requestHash` ships as a zero placeholder for now, since
   `JobEscrow.createJob()` doesn't check this field until Phase 3 either, and a
   real-looking-but-fake hash would be actively misleading. Wire the real call in together
   with Phase 3, not before.
2. On a request presenting `jobId`: view-call `JobEscrow.jobs(jobId)` to confirm
   `status == Active` and matching `sellerAgentId`/`amount`, then let the existing handler run
   unchanged.

Individual route files (`app/api/premium/*/route.ts`) needed no change, confirmed by directly
re-reading `quote/route.ts` — all rewiring is centralized in `lib/x402.ts`, exactly as this
plan expected.

## Release → optional Gateway deposit

After a buyer's `release()` tx confirms, notify a new seller-side route that independently
re-verifies on-chain status before calling whatever Gateway SDK method mirrors the existing
`app/api/gateway/withdraw/route.ts` pattern. **Exact method name unconfirmed** — read that
file first once cloned, don't guess the SDK call.

## Open questions / assumptions

- ~~The precise shape of the current `gateway.pay()` call site and `facilitator.settle()`~~ —
  **closed 2026-07-26**: both read in the real clone (`agent.mts:268`, `lib/x402.ts:126`);
  see "What the fork actually is" above.
- ~~How `agent.mts` instantiates its LLM~~ — **closed 2026-07-26**: it doesn't; no LLM code
  shipped. If we add an LLM judgment layer, we write it ourselves with the already-installed
  LangChain deps pointed at Groq's free tier (OpenAI-compatible base URL).
- Whether any of the four paywalled routes (`quote`, `dataset`, `compute`, `agent-task`) have
  route-specific logic beyond calling into `withGateway()` that would need individual changes
  — **closed 2026-08-03**: confirmed no, re-read `quote/route.ts` directly — it's a single
  line, `withGateway(handler, "$0.001", "/api/premium/quote")`.
- ~~The Gateway SDK method that mirrors the existing seller withdraw-flow pattern~~ —
  **closed 2026-08-03**: read `app/api/gateway/withdraw/route.ts` directly. It's
  `gateway.withdraw(amount, { chain, recipient })` on a `GatewayClient` instance, returning
  `{ mintTxHash, formattedAmount, sourceChain, destinationChain, recipient }`.

## Build order

Starts once [`03-job-escrow.md`](03-job-escrow.md)'s interface is stable — doesn't need to
wait on Phase 3 (Validation Registry wiring) or Phase 4 (deploy) to *start*, but does need
real deployed addresses to actually run end-to-end.
