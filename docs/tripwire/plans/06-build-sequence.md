# 6. Build sequence

Status: **this file is the single source of truth for "where are we right now."** Update its
checkboxes as work happens — don't let it drift out of sync with the actual repo state. As of
2026-07-26, every box below is unchecked; nothing has been implemented.

## Phase 0 — Baseline

Prerequisites (verified working on this machine 2026-07-26): Node v22.22.2, `gh`
authenticated as CHEF-SAVY, Foundry 1.5.1, Docker 29.6.2. Supabase runs via `npx supabase`
(no global CLI needed) — the seller app hard-depends on it for payment-event persistence and
its realtime dashboard.

**LLM finding (2026-07-26, supersedes the earlier "mock mode" framing):** the shipped
`agent.mts` contains **no LLM code at all** — it's a scripted Gateway payment loop; the
LangChain/DeepAgents agent the README describes never shipped (see
[`04-backend-integration.md`](04-backend-integration.md)). So **no API key is needed for the
baseline, period.** If we later add an LLM judgment layer for the demo, the decision stands:
**Groq free tier** (OpenAI-compatible, ~30 req/min / 1K req/day, tool calling on
`llama-3.3-70b-versatile`), fallback **Gemini free tier** — both verified free as of
2026-07-26, no card required.

- [x] Fork `circlefin/arc-nanopayments` on GitHub. *(2026-07-26 → CHEF-SAVY/arc-nanopayments)*
- [x] Clone it into this project's working tree. *(→ `arc-nanopayments/`)*
- [x] `npm install`; copy `.env.example` → `.env.local`. *(2026-07-26)*
- [x] `npm run generate-wallets`. *(2026-07-26 — buyer `0x6C0f42E1B229746D3AD4445a2700E336a3479072`)*
- [x] Fund the buyer wallet via `faucet.circle.com`. *(2026-07-26 — 20 USDC, visible both as
      native gas balance (18-dec) and via the ERC-20 facade at `0x3600…0000` (6-dec) —
      confirmed same funds, two views)*
- [x] Set up Supabase locally. *(2026-07-26 — full stack up via `npx supabase start`;
      **required a fix**: the repo's migrations rely on default privileges that don't apply
      on a fresh local stack, so service-role inserts failed with "permission denied" —
      added `supabase/migrations/20260726000000_explicit_grants.sql` in the fork)*
- [x] Confirm the buyer→seller x402 flow end-to-end on Arc testnet. *(2026-07-26 — 402 →
      signed authorization → facilitator verify → settle → content + Supabase event row.
      **Required a fix**: the repo's hardcoded `maxTimeoutSeconds: 345600` (4d) now fails
      Circle's facilitator with `authorization_validity_too_short` — the authorization must
      outlive the Gateway Wallet's on-chain `withdrawalDelay` (1209600s = 14d); set to 15d
      in `lib/x402.ts`. Note: each `npm run agent` run strands its remaining Gateway balance
      on a throwaway ephemeral key — our rewiring drops that pattern anyway)*
- [x] `forge init` a `contracts/` Foundry project alongside the fork. *(2026-07-26 —
      forge-std v1.16.2, boilerplate removed, `arc_testnet` RPC in foundry.toml)*
- [x] Install OpenZeppelin + forge-std. *(OpenZeppelin v5.6.1)*
- [x] Register buyer/seller `agentId`s on the Identity Registry. *(2026-07-26 — buyer
      `agentId 851888` (tx `0xd3ab8669…`), seller `agentId 851889` (tx `0x3d70e969…`);
      `ownerOf` verified for both; IDs recorded in the gitignored `.env.local`. Real ABI
      pulled from Arcscan first: impl `IdentityRegistryUpgradeable` at `0x7274e874…`, three
      `register()` overloads — used `register(string agentURI)`)*
- [x] Sanity-check USDC behaves as plain ERC20. *(2026-07-26 — `approve` → `allowance` →
      `transferFrom` → allowance consumed to 0, balance credited: exactly the calls
      `SellerBond.deposit`/`JobEscrow.createJob` rely on. One Arc-specific subtlety for
      contract/backend design: gas is paid from the same USDC balance being transferred, so
      "transfer my whole balance" transactions can fail — never assume balance == spendable)*

**Phase 0 complete (2026-07-26).**
- [x] `git init` this repo. *(2026-07-26 — root repo tracks docs + plans, one commit per
      plan file per the project owner's instruction)*
- [x] Flatten into a single repo. *(2026-07-26, owner's decision — `arc-nanopayments/` and
      `contracts/` de-gitted and committed into the root repo: fork imported as a pristine
      upstream snapshot with the two baseline fixes re-applied on top as their own commits;
      Foundry libs vendored (de-submoduled) so one clone builds without `--recursive`.
      Nothing pushed to GitHub yet)*

**Repo/infra log (2026-07-26, after Phase 0):** repo live at
`github.com/tripwire-labs/Tripwire` — single flattened repo, pushed by the owner (standing
rule: Claude never pushes). CI on every branch: `forge fmt --check` + build + test, npm
lint + `tsc --noEmit` — all green. Root LICENSE (Apache-2.0), `.editorconfig`, real
`contracts/README.md`. Workflow v2: **every discrete change gets a fresh branch from
`main` → PR (merged by the owner on GitHub) → branch deleted**; the original long-lived
plan branches are obsolete. `plans/` + the three root docs are local-only (gitignored);
commits carry no AI attribution.

## Phase 1 — `SellerBond.sol`
Plan: [`02-seller-bond.md`](02-seller-bond.md). Tests: [`05-testing.md`](05-testing.md).
- [x] Skeleton (signatures only, no bodies) — reviewed; merged via PR #1 (2026-07-26),
      conventions follow-up merged via PR #3. Design calls resolved at review: `deposit`
      restricted to the agent's owner/operator; minimal `IIdentityRegistry` interface from
      the verified ABI.
- [x] `deposit` / `bondOf` against mocks, tests green. *(2026-07-26, PR #2 — 9 tests incl.
      fuzz; mocks `MockUSDC` + `MockIdentityRegistry` established under `test/mocks/`;
      CEI + SafeERC20; densely commented per the study-friendly code rule)*
- [x] `requestWithdrawal` / `completeWithdrawal` / timelock, tests green. *(2026-07-27,
      `feat/sellerbond-withdrawals` — 18 new tests (27 total incl. fuzz netting identity).
      Design calls resolved at review: `completeWithdrawal` gated to owner/operator but
      always pays `ownerOf(agentId)` (operator can trigger, never redirect; mid-timelock
      agent transfer pays the new owner); `setWithdrawalTimelock` capped at
      `MAX_WITHDRAWAL_TIMELOCK = 30 days`, no minimum (demo needs short timelocks); no
      cancel function — a mistaken request matures and re-deposits. `onlyOwner` implemented
      via internal `_checkOwner()` per forge lint's unwrapped-modifier-logic rule)*
- [x] `reserve` / `releaseReservation` / `slash`, tests green. *(2026-07-31,
      `feat/sellerbond-reserve-slash` — 14 new tests (41 total). `onlyJobEscrow` implemented
      via internal `_checkJobEscrow()`, same pattern as `onlyOwner`. Design call resolved at
      review: added a `ZeroAmount` guard to all three (not spelled out in the plan) since
      these are JobEscrow-only calls — a zero-amount call would be a caller-side bug, so it
      should fail loudly rather than silently no-op. `reserve` checks against `bondOf()`
      (nets reservations + pending withdrawal); `slash` requires `amount <= reserved[agentId]`
      and decrements both `bondBalance` and `reserved` together so confiscated stake can
      never resurface. Explicit invariant test added:
      `test_PendingWithdrawalNeverDipsIntoReservedBond`)*
- [x] Full `SellerBond` suite green before moving to Phase 2. *(2026-07-31 — 41/41 passing,
      `forge fmt --check` clean, `forge build` clean)*

## Phase 2 — `JobEscrow.sol` (Validation Registry disabled initially)
Plan: [`03-job-escrow.md`](03-job-escrow.md). Tests: [`05-testing.md`](05-testing.md).
- [x] Skeleton — reviewed. *(2026-07-31, `feat/jobescrow-skeleton`, commit `f8036e3` — state,
      events, errors, all function signatures with TODO bodies; new `ISellerBond` interface
      (safe to hand-write, it's our own contract). `VALIDATION_REGISTRY` kept as a raw
      `address`, not a typed interface, until the real ABI is pulled off Arcscan in Phase 3 —
      no hand-written interface from memory. Design calls resolved at review: added
      `setSellerBond`/`setMinBondRatioBps`/`setResponseWindow` — implied by the state
      section's "owner-settable" comments but missing from the plan's original Functions
      list, same gap class as `setWithdrawalTimelock` in plan 02; `plans/03-job-escrow.md`
      updated to list them explicitly. `sellerPayoutAddress` snapshots at `createJob()` time
      (not re-read at payout) — resolves the plan's other open question, protects an
      in-flight job from a mid-job agent-NFT transfer.)*
- [x] `createJob` / `release` happy path wired to the real `SellerBond` (two-step deploy).
      *(2026-07-31, `feat/jobescrow-skeleton` commit `3cac6ca` — also implemented
      `setSellerBond` (needed to wire the two-step deploy for tests at all). 15 new tests
      (56 total across both contracts), `forge fmt`/`build`/`test` all clean. `release`
      enforces invariant 4's window (`completionDeadline + responseWindow`) even though
      `dispute`/`claimTimeout` don't exist yet, so it doesn't need revisiting later.
      **Branch dependency discovered mid-step**: this branch was correctly cut from `main`
      (per the branching correction earlier in the session), but `main` doesn't have
      `SellerBond`'s `reserve`/`releaseReservation`/`slash` yet — those only exist on the
      still-unpushed `feat/sellerbond-reserve-slash` (commit `8d09701`). Without them,
      `reserve()` is an empty `TODO` stub that silently no-ops (no revert, no state
      change) — tests failed on that exact symptom (`reserved()` stayed 0 after a
      "successful" call) until diagnosed. Fixed by locally merging
      `feat/sellerbond-reserve-slash` into `feat/jobescrow-skeleton` (merge commit,
      no push) so tests could run for real. **Resolved same day**: user merged PR #5
      (`feat/sellerbond-reserve-slash`); `feat/jobescrow-skeleton` rebased cleanly onto
      the refreshed `main` (commits `c716888`/`e6abf99`) — the local merge commit is
      gone, diff is just this branch's own files, all 56 tests still green. Push-ready.)*
- [x] `dispute` / `resolveDispute` including the reservation-slash path. *(2026-07-31,
      `feat/jobescrow-dispute-resolve` commit `d4d7450` — `dispute` mirrors `release`'s
      guard structure exactly (`onlyBuyer`, `Active`, same response-window cutoff), just
      no fund movement. `resolveDispute` branches on `sellerAtFault`: true calls
      `sellerBond.slash()` (bond → buyer) plus a separate escrow refund (buyer receives
      two payments, the core "compensation beyond a refund" mechanic); false pays out
      identically to `release()`. Also implemented `claimTimeout` and the two remaining
      setters (`setMinBondRatioBps`/`setResponseWindow`) in the same pass — see below.
      **Flagged, not built**: a `Disputed` job has no timeout rescue if the arbiter never
      calls `resolveDispute` (unlike `Active`, which has `claimTimeout`) — documented as a
      known limitation in `plans/08-disclosures.md` alongside the single-arbiter
      disclosure, not fixed (out of scope for the MVP, arbiter is already a trusted
      centralized party).)*
- [x] `claimTimeout`. *(2026-07-31, same commit as above — anyone may call once
      `completionDeadline + responseWindow` has passed on an `Active` job; same payout
      path as `release`. Also added `MAX_MIN_BOND_RATIO_BPS = 10_000` (100%) and
      `MAX_RESPONSE_WINDOW = 30 days` caps on the two new setters, mirroring
      `SellerBond.MAX_WITHDRAWAL_TIMELOCK`'s reasoning — bounds what a careless/
      compromised owner key can brick or freeze, no minimum so both can go near-zero for
      demo recordings.)*
- [x] Full suite green with mocked registries. *(2026-07-31 — 73/73 tests passing across
      both contracts (32 in `JobEscrow.t.sol`), `forge fmt`/`build` clean.
      `JobEscrow.sol`'s core logic is now fully implemented — everything remaining in
      Phase 2/3 is Validation Registry wiring, not new state-machine logic.)*
- [x] **Manual audit of `JobEscrow.sol`, 2026-08-03** (`feat/jobescrow-dispute-resolve`
      commit `a638b92`, 80/80 tests, 39 in `JobEscrow.t.sol`). Checked reentrancy, CEI
      ordering, access control, arithmetic, cross-contract invariants against
      `SellerBond`. Reentrancy is a non-issue (state updates always precede external
      calls; USDC's plain ERC-20 `transfer` has no recipient hooks). Three real findings,
      all fixed — see the new invariants 5–7 in `plans/03-job-escrow.md`:
      1. `responseWindow` wasn't snapshotted per job — owner could retroactively shift an
         in-flight job's effective deadline. Fixed: new `Job.responseDeadline` field,
         snapshotted at `createJob()`, read everywhere instead of recomputed.
      2. `completionDeadline` had no upper bound — a value near `type(uint64).max` (a
         plausible "no real deadline" sentinel, the same convention this codebase's own
         tests use for USDC allowances) makes `completionDeadline + responseWindow`
         overflow and revert in every exit path, permanently locking a job's escrow and
         reserved bond. Fixed: `MAX_JOB_DURATION = 365 days` cap in `createJob`, not
         owner-settable (structural bound, not a risk parameter).
      3. `minBondRatioBps = 0` was documented as a valid demo config but always reverted
         `createJob` (`SellerBond.reserve()` rejects zero-amount calls). Fixed: `reservedBond
         > 0` guards around every `SellerBond` call in `createJob`/`release`/
         `resolveDispute`/`claimTimeout`, so a 0%-ratio job runs its full lifecycle without
         ever touching `SellerBond`.
      PR message updated at `plans/pr/feat-jobescrow-dispute-resolve.md` with the fix
      section appended.

## Phase 3 — ERC-8004 wiring
- [x] Pull the real Validation Registry ABI off Arcscan for
      `0xDB31f5d9167f8ebc8B30FbBF814c4d297c2D7F99` — resolve the open question in
      [`01-research-and-decisions.md`](01-research-and-decisions.md) about the exact getter
      name. *(Re-verified live 2026-08-06 against Arcscan's contract API — matches prior
      research exactly: `getValidationStatus` reverts on unknown hash, `validationResponse`
      requires `msg.sender == validatorAddress`.)*
- [x] Add the `requestHash` check to `createJob`. *(2026-08-06,
      `feat/jobescrow-validation-registry` — new `IValidationRegistry.sol`, public
      `isValidationRequestValid` view helper shared by the gate and off-chain monitoring,
      dedicated `ValidationRequestInvalid` error, `setValidationRegistryEnabled` kill switch.)*
- [x] Add `try/catch`-wrapped `validationResponse` calls at `release`/`resolveDispute`/
      `claimTimeout`. *(Same branch — new `_attestValidation` internal helper, distinct
      response/tag per call site; `resolveDispute(sellerAtFault=true)` attaches the buyer's
      real `evidenceHash` as `responseHash`.)*
- [x] Run `ArcForkIntegration.t.sol` against the live registry as a pre-deploy gate. *(Same
      branch, 4/4 passing. Caught a real bug in prior research on first run:
      `validationRequest()` is NOT permissionless as previously assumed — the real registry
      requires `msg.sender` to be the agentId's owner or an approved operator. Doesn't affect
      `JobEscrow` itself, but is now a confirmed hard constraint for the Phase 3b backend
      work below. CI's default `forge test` now excludes this suite
      (`--no-match-contract ArcForkIntegration`) since it forks live testnet in `setUp()` —
      run it explicitly before Phase 4.)*
- [x] **Phase 3b (backend wiring).** *(2026-08-07, `feat/backend-validation-registry`,
      commit `8e9e141`, not yet pushed/merged.)* New `lib/validationRegistry.ts` +
      `lib/x402.ts`'s `!jobIdHeader` branch now calls the real `validationRequest()`
      instead of sending `zeroHash`, reusing `SELLER_PRIVATE_KEY` directly (confirmed via
      `cast wallet address` to already be `sellerAgentId`'s real owner — no new
      operator wallet needed). Verified live against the real deployed registry via the
      dev server + `cast call getValidationStatus`, not just typechecked. Endpoint-binding
      (closing the replay gap `lib/x402.ts`'s own comment flags) remains deliberately
      deferred — still needs documenting as a known limitation in
      [`08-disclosures.md`](08-disclosures.md), not yet done.

## Phase 4 — Deploy
**DONE — 2026-08-07.** Deployed via new `contracts/script/Deploy.s.sol` (one broadcast,
three ordered txs from the same deployer wallet), on the `main` branch (script committed
directly, no feature branch needed for a one-shot deploy script).
- [x] Re-confirm addresses against `docs.arc.io/arc/references/contract-addresses` —
      re-checked live 2026-08-07 via WebFetch and Arcscan's contract API (not the
      four-plus-day-old table in `01-research-and-decisions.md`). USDC and the ERC-8004
      registries unchanged.
- [x] Deploy `JobEscrow` first.
- [x] Deploy `SellerBond` with `JobEscrow`'s address baked in.
- [x] Call `JobEscrow.setSellerBond()` once.
- [x] Verify both contracts on Arcscan — both show `Pass - Verified`.
- [x] Record deployed addresses in this file and in the README (README still pending,
      Phase 7).

### Deployed addresses (Arc testnet, 2026-08-07)

| Contract | Address | Arcscan |
|---|---|---|
| `JobEscrow` | `0x550c28Ec54A89e430887230C07C34FECc3F590Cf` | [verified](https://testnet.arcscan.app/address/0x550c28ec54a89e430887230c07c34fecc3f590cf) |
| `SellerBond` | `0x2695C5795F586136eed2F1007bDD31c2b60943bE` | [verified](https://testnet.arcscan.app/address/0x2695c5795f586136eed2f1007bdd31c2b60943be) |

**Owner / ARBITER (both contracts): `0xC2Ce96f61a40B54C74f30f1Da73E3b8dcf3e2A2c`** — a
fresh, dedicated wallet generated specifically for this role (not the buyer or seller
wallet), per the decision locked in before deploying: keeps the disclosed "single
arbiter" trust model coherent (arbiter is a genuinely separate party from both sides of
any dispute it resolves). Neither contract has a `transferOwnership` function (confirmed
during the pre-deploy audit) — this is permanent. Private key in gitignored
`contracts/.env` (`DEPLOYER_PRIVATE_KEY`); address also recorded there
(`DEPLOYER_ADDRESS`) and in `arc-nanopayments/.env.local`/`.env.example`
(`ARBITER_ADDRESS`).

Sanity-checked on-chain post-deploy: `jobEscrow.sellerBond()` returns the exact
`SellerBond` address above (wiring confirmed landed), `owner()`/`ARBITER()` both return
the deployer address.

## Phase 5 — Backend rewiring
Plan: [`04-backend-integration.md`](04-backend-integration.md).
- [x] Re-verify the plan's file:line claims against the actual cloned fork before writing
      anything. *(2026-08-03 — re-read `agent.mts`, `lib/x402.ts`, `quote/route.ts`,
      `app/api/gateway/withdraw/route.ts` in full; every claim in `04-backend-integration.md`
      matched the real code exactly. Closed two remaining open questions in that doc: routes
      have no logic beyond `withGateway()`; the Gateway withdraw SDK method is
      `gateway.withdraw(amount, {chain, recipient})`.)*
- [x] New `lib/jobEscrow.ts` — shared module for both sides: minimal ABI (copied from the
      real Foundry build artifact, `contracts/out/` being gitignored so it can't be imported
      directly — not hand-written, same discipline as the Solidity minimal interfaces),
      `getJob()` (read), `createJob`/`releaseJob`/`disputeJob` (write, simulate-then-write
      via viem to recover `createJob`'s return value from what's otherwise just a tx hash).
- [x] Seller side (`lib/x402.ts`). *(2026-08-03, `feat/backend-seller-escrow-rewire` commit
      `5b83893`.) `withGateway()`'s first hit now returns a plain JSON 402 body — `price`,
      `sellerAgentId`, `requestHash` (zero placeholder, see below), `jobEscrowAddress` — no
      longer the old base64 `PAYMENT-REQUIRED` header, which existed only to satisfy x402's
      signed-payload convention. The retry reads an `x-job-id` header and verifies the job
      on-chain (`Active`, right seller, right amount) via a read-only call before running the
      handler — no signature to check, the chain itself is the source of truth. Supabase
      `payment_events` recording kept, now recording job data instead of settlement data, so
      the existing realtime dashboard keeps working. **Known, deliberate limitation**: the
      check only verifies seller + amount, not which specific endpoint a job was quoted for
      — today's four routes have distinct prices so this can't collide by accident, but nothing
      structurally prevents replaying a job across two same-priced endpoints. That's exactly
      what Phase 3's real `requestHash` binding is meant to close; not fixed here since the
      contract side doesn't enforce it yet either.
- [x] Buyer side (`agent.mts`). *(2026-08-03, same commit.)* Two deliberate departures from
      a literal reading of the plan, both flagged and agreed before implementing:
      1. **Dropped the ephemeral-wallet funding dance entirely** (~140 of the old 297 lines).
         It existed only because Gateway's `pay()` needed its own signer; escrow has no such
         requirement — the funder wallet (`BUYER_PRIVATE_KEY`) calls `createJob()` directly.
      2. **Single clean pass per run, not the old infinite 1-tx/sec loop.** The demo script
         (`CLAUDE.md`) wants exactly two recordable runs (clean release, dispute), which is a
         one-job-at-a-time shape, not a spam loop — and escrow jobs are heavier per
         "payment" (approve + createJob + release/dispute, 2-3 real transactions) than the old
         instant Gateway `pay()`, so the loop model didn't fit the new mechanism anyway.
      New flow: unauthenticated request → parse 402 JSON → `usdc.approve()` → `createJob()` →
      retry with `x-job-id` → judge the response (non-empty + valid JSON, the plan's MVP bar)
      → `release()` or `dispute()`. Added a `--dispute` CLI flag that forces the bad-delivery
      verdict regardless of actual content — lets one script drive both demo runs without
      needing the seller to ever actually deliver garbage. `--endpoint` picks which of the
      four routes to demo against (default `quote`).
      **Verified live** (dev server + real seller code, real Arc testnet RPC): the full 402 →
      parse → USDC `approve()` sequence executed for real and confirmed on-chain (buyer
      wallet's real Phase-0 faucet funds — flagged to the user as a real, if tiny, testnet
      spend). `createJob` correctly failed at viem's simulation step against the placeholder
      `JOB_ESCROW_ADDRESS` (not a real contract) — proves the safety net catches a bad address
      before ever submitting a wasted transaction. Full pass blocked only on Phase 4's real
      deploy, the already-known dependency.
      `tsc --noEmit`, `eslint .`, and `next build` all clean throughout.
- [x] **Strict audit of the backend rewiring, 2026-08-03** (same branch, commit
      `b8debf4`). Re-read `lib/x402.ts`/`lib/jobEscrow.ts` adversarially — not "does
      this match the plan" but "what can an attacker actually do." One critical
      finding, two lesser ones, all fixed:
      1. **Critical — delivery wasn't bound to the paying buyer.** The retry check
         verified the job existed, was `Active`, and had the right seller/amount, but
         never checked the HTTP caller was actually `job.buyer`. Since `jobId`s are
         sequential public integers (readable for free via `nextJobId()` or the
         `JobCreated` event log), anyone who saw or guessed a valid `jobId` could
         redeem someone else's paid content — repeatedly, since nothing marks a job
         "already delivered." This was a gap in the *design*, not just the
         implementation (the original plan's seller steps never called for a
         buyer-identity check either) — re-checking against the plan wouldn't have
         caught it, only checking against "what can an attacker do" did. **Fixed**:
         new `signJobId`/`recoverJobIdSigner` helpers in `lib/jobEscrow.ts` — buyer
         signs a message binding to the specific `jobId` (`viem`'s `signMessage`),
         sends it as `x-job-signature`, seller recovers the signer
         (`recoverMessageAddress`) and checks it equals `job.buyer`. Verified the
         round-trip directly (throwaway script, not committed): signing then
         recovering returns the exact signer address, and reusing the same signature
         against a *different* jobId recovers a completely different address —
         confirms a signature can't be replayed across jobs.
      2. **Medium — no error handling on the retry path.** A negative `x-job-id`
         (`BigInt("-1")` parses fine, then fails deep inside viem's ABI encoding) or
         an RPC hiccup threw uncaught, unlike the old code's blanket try/catch with a
         clean 500. **Fixed**: explicit `jobId >= 0` check, `getJob`/Supabase calls
         wrapped in `try/catch` returning clean JSON errors.
      3. **Low-Medium — env var validation was type-assertion-only.**
         `JOB_ESCROW_ADDRESS` was checked for presence but not shape (a malformed
         value would fail later with a cryptic viem error); `SELLER_AGENT_ID` silently
         defaulted to `0n` if unset, hiding a real misconfiguration behind a confusing
         "wrong seller" rejection. **Fixed**: hex-address regex validation, explicit
         throw-at-load if `SELLER_AGENT_ID` is unset (mirrors `JOB_ESCROW_ADDRESS`'s
         existing fail-loud pattern).
      Re-verified live after fixing: curl against a running dev server confirms 402
      (no jobId) / 401 (jobId, no signature) / 400 (negative jobId) all behave exactly
      as designed. `tsc --noEmit`, `eslint .` clean. PR message updated at
      `plans/pr/feat-backend-seller-escrow-rewire.md` with the full findings.
- [ ] Optional release → Gateway deposit step. *(Stretch goal per CLAUDE.md — lowest
      priority, only if time remains after the deploy/demo/README work.)*

## Phase 6 — Demo scripts + README
Plan: [`07-demo-and-deployment.md`](07-demo-and-deployment.md),
[`08-disclosures.md`](08-disclosures.md).
- [ ] Can start as soon as Phase 2 is done — decoupled from backend wiring finishing.
- [ ] Raw `cast send` scripts for both demo runs (clean release; dispute + slash).
- [ ] README covering the gap being filled, the honest disclosures, deployed addresses.

## Phase 7 — Stretch (post-Checkpoint-2, only if time allows)
- [ ] Tighter delivery validation (beyond "non-empty, matches request").
- [ ] Seller dashboard polish (the forked repo's existing dashboard, if extended).
- [ ] App Kit bridging as an onboarding flow (explicitly out of MVP scope per
      `PROJECT_OVERVIEW.md` §3).

## Definition of done (from `CLAUDE.md`, restated here for one-glance tracking)
- [ ] `SellerBond.sol` and `JobEscrow.sol` deployed and verified on Arc testnet.
- [ ] Backend actually creating real jobs through the forked agent flow — not a mocked call.
- [ ] Both demo runs (clean release, disputed slash) working end-to-end and recordable.
- [ ] Foundry tests for: bond deposit/withdrawal timelock/slash-only-by-escrow, job creation
      with bond-ratio check, release, dispute, timeout auto-release.
- [ ] README documenting the gap being filled, with the disclosures from
      [`08-disclosures.md`](08-disclosures.md).
