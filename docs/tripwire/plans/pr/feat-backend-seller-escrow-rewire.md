# PR message — feat/backend-seller-escrow-rewire

Copy the Title into GitHub's title field (it otherwise auto-fills from the branch
name), and everything below the line into the description.

Title:

Backend: rewire buyer/seller x402 flow onto JobEscrow instead of Gateway settlement

---

PR: feat/backend-seller-escrow-rewire → main

Title: Backend: rewire buyer/seller x402 flow onto JobEscrow instead of Gateway
settlement

## What

Rewires the forked `arc-nanopayments` app's buyer (`agent.mts`) and seller
(`lib/x402.ts`) so payment settles into `JobEscrow` instead of an immediate Circle
Gateway `pay()`/`settle()`. Re-verified every plan claim directly against the cloned
fork before writing anything (`agent.mts`, `lib/x402.ts`, `quote/route.ts`,
`withdraw/route.ts` all re-read in full) — no discrepancies found.

- **New `lib/jobEscrow.ts`** — shared module for both sides. Minimal ABI copied from
  the real compiled artifact (`contracts/out/`, gitignored so it can't be imported
  directly — not hand-written from memory, same discipline as the Solidity side's own
  minimal interfaces). `getJob()` (read); `createJob`/`releaseJob`/`disputeJob`
  (write, using viem's simulate-then-write pattern to recover `createJob`'s
  `returns (uint256 jobId)` value, which a real transaction can't hand back directly).
- **Seller (`lib/x402.ts`)** — `withGateway()`'s first hit now returns a plain JSON
  402 body (`price`, `sellerAgentId`, `requestHash`, `jobEscrowAddress`) instead of
  the old base64 `PAYMENT-REQUIRED` header, which existed only for x402's
  signed-payload convention. The retry reads an `x-job-id` header plus an
  `x-job-signature`, verifies the job on-chain (`Active`, right seller, right
  amount) via a read-only call, and confirms the signature was produced by
  `job.buyer` before running the handler (see Audit findings below for why the
  signature check exists at all). Supabase `payment_events` recording kept, now
  recording job data instead of settlement data.
- **Buyer (`agent.mts`)** — rewritten around one job per run: unauthenticated
  request → parse 402 → `usdc.approve()` → `createJob()` → sign the `jobId` → retry
  with `x-job-id`/`x-job-signature` → judge the response (non-empty + valid JSON,
  the plan's MVP bar) → `release()` or `dispute()`. New `--dispute` flag forces the
  bad-delivery verdict regardless of actual content; `--endpoint` picks which of the
  four routes to demo against (default `quote`).

## Why

- **Dropped the ephemeral-wallet funding dance** (~140 of the old 297 lines). It
  existed only because Gateway's `pay()` needed its own signer; escrow doesn't — the
  funder wallet (`BUYER_PRIVATE_KEY`) calls `createJob()` directly. The plan itself
  flagged this as unnecessary once escrow replaces Gateway.
- **Dropped the infinite 1-tx/sec loop for a single clean pass.** `CLAUDE.md`'s demo
  script wants exactly two recordable runs (clean release, dispute) — a one-job
  shape, not a spam loop — and escrow jobs are heavier per "payment" (approve +
  createJob + release/dispute, 2-3 real transactions) than the old instant Gateway
  `pay()`, so the loop model didn't fit the new mechanism anyway. The `--dispute`
  flag lets one script drive both demo runs without needing the seller to actually
  deliver garbage on purpose.
- **`requestHash` stays a zero placeholder.** `JobEscrow.createJob()` doesn't check
  this field until Phase 3 wires in the real Validation Registry — generating a
  real-looking hash without an actual `validationRequest()` call behind it would be
  misleading, not more correct.
- **Known, deliberate limitation**: job verification on the retry only checks seller
  + amount, not which specific endpoint a job was quoted for. Today's four routes
  have distinct prices ($0.0003–$0.03) so this can't collide by accident, but nothing
  structurally prevents replaying a job across two same-priced endpoints — that's
  exactly what Phase 3's real `requestHash` binding closes. Not fixed here since the
  contract side doesn't enforce it yet either.

## Testing

No test runner exists for the TS app (CI is lint + typecheck only) — verified
instead via:

- `npx tsc --noEmit` and `npm run lint` clean throughout.
- `npm run build` (`next build`) succeeds; all four premium routes compile as
  expected dynamic routes.
- **Live smoke test** against a real running dev server, real Arc testnet RPC, and a
  placeholder `JOB_ESCROW_ADDRESS`: confirmed the full 402 → parse → `usdc.approve()`
  sequence executes correctly end-to-end — the `approve()` call actually confirmed
  on-chain using the buyer wallet's real Phase 0 faucet funds (flagged to the user as
  a real, if tiny — 0.001 USDC approval to a non-contract address — testnet spend).
  `createJob` then correctly failed at viem's simulation step against the
  placeholder address (not a real contract), proving the simulate-first pattern
  catches a bad target before ever submitting a wasted transaction.
- A full pass end-to-end is blocked only on Phase 4's real deploy — the already-known
  dependency this phase was explicitly allowed to start ahead of.

## Audit findings & fixes (added 2026-08-03, same branch)

Ran a strict audit on the rewiring before considering it push-ready — not "does this
match the plan" but "what can an attacker actually do." One critical finding, two
lesser ones, all fixed here.

1. **Critical: delivery wasn't bound to the paying buyer.** The original retry check
   verified a job existed, was `Active`, and had the right seller/amount — but never
   checked that the HTTP caller was actually `job.buyer`. `jobId`s are sequential
   public integers, freely readable via `nextJobId()` or the `JobCreated` event log,
   so anyone who saw or guessed a valid `jobId` could redeem someone else's paid
   content. Worse, nothing marked a job "already delivered" on the HTTP side, so the
   same job could be replayed for free delivery indefinitely by anyone, for as long
   as it stayed `Active` — a scraper polling `nextJobId()` could pull every
   currently-active paid resource for free. This was a gap in the *design*: the
   original plan's seller steps only ever specified checking status/seller/amount
   too, so implementing faithfully against the plan wouldn't have caught it — only
   asking "what can an attacker do" did.

   **Fix**: new `signJobId`/`recoverJobIdSigner` helpers in `lib/jobEscrow.ts`. The
   buyer signs a message binding to the specific `jobId` (`Tripwire:job:<id>`, via
   viem's `signMessage`) and sends it as `x-job-signature`; the seller recovers the
   signer (`recoverMessageAddress`) and checks it equals `job.buyer`. Functionally
   this restores the role the old `payment-signature` header used to serve (proving
   payer identity), which got dropped without a replacement in the first pass.
   Verified the round-trip directly with a throwaway script (not committed): signing
   then recovering returns the exact signer address, and reusing the same signature
   against a *different* `jobId` recovers a completely unrelated address — confirms
   a signature is bound to one job and can't be replayed across others.

2. **Medium: no error handling on the retry path.** `x-job-id: -1` parses fine via
   `BigInt("-1")`, then throws uncaught deep inside viem's uint256 ABI encoding; an
   RPC hiccup during `getJob()` was equally uncaught. Both bypassed the clean JSON
   error responses the rest of the function used, unlike the old code's blanket
   try/catch.

   **Fix**: explicit `jobId >= 0` check before the RPC call; `getJob()` and the
   Supabase insert both wrapped in `try/catch` returning clean error responses
   instead of an unhandled crash.

3. **Low-Medium: env var validation was type-assertion-only.** `JOB_ESCROW_ADDRESS`
   was checked for presence but not shape — a malformed value would sail past the
   guard and fail later with a cryptic viem error instead of a clear one.
   `SELLER_AGENT_ID` silently defaulted to `0n` if unset, hiding a real
   misconfiguration behind a confusing "wrong seller" rejection on every request.

   **Fix**: hex-address regex validation for `JOB_ESCROW_ADDRESS`; explicit
   throw-at-module-load if `SELLER_AGENT_ID` is unset, mirroring the fail-loud
   pattern `JOB_ESCROW_ADDRESS` already had.

Re-verified live after fixing: curl against a running dev server confirms 402 (no
jobId) / 401 (jobId present, no signature) / 400 (negative jobId) all behave exactly
as designed. `tsc --noEmit` and `eslint .` clean.
