# PR message — feat/jobescrow-dispute-resolve

Copy the Title into GitHub's title field (it otherwise auto-fills from the branch
name), and everything below the line into the description.

Title:

JobEscrow: implement dispute, resolveDispute, claimTimeout, and remaining setters

---

PR: feat/jobescrow-dispute-resolve → main

Title: JobEscrow: implement dispute, resolveDispute, claimTimeout, and remaining
setters

## What

The rest of `JobEscrow.sol`'s core logic — everything left except Validation
Registry wiring (Phase 3):

- **`dispute(jobId, evidenceHash)`** — mirrors `release`'s guard structure exactly
  (`onlyBuyer`, requires `Active`, same `completionDeadline + responseWindow`
  cutoff). Records the evidence hash on-chain (not raw evidence) and flips status
  to `Disputed`. No fund movement — that's `resolveDispute`'s job.
- **`resolveDispute(jobId, sellerAtFault)`** — `onlyArbiter`, requires `Disputed`.
  `sellerAtFault == true`: `sellerBond.slash(sellerAgentId, reservedBond, buyer)`
  **plus** a separate `USDC.safeTransfer(buyer, amount)` refund from escrow — the
  buyer receives two payments, which is the actual "compensation beyond a refund"
  mechanic the whole project is built around. `sellerAtFault == false`: pays out
  identically to `release()`.
- **`claimTimeout(jobId)`** — callable by anyone, requires `Active` and
  `block.timestamp >= completionDeadline + responseWindow`. Same payout path as
  `release()`. Without this a buyer could grief a seller forever by never calling
  `release`/`dispute`.
- **`setMinBondRatioBps`/`setResponseWindow`** — the two remaining owner-only
  setters from the skeleton. Added caps: `MAX_MIN_BOND_RATIO_BPS = 10_000` (100%)
  and `MAX_RESPONSE_WINDOW = 30 days`, mirroring `SellerBond.MAX_WITHDRAWAL_TIMELOCK`
  exactly — bounds what a careless/compromised owner key can brick (an
  over-100%-bond requirement would make `createJob` impossible) or freeze (a
  century-long response window would make `claimTimeout` meaningless). Neither has
  a minimum, so both can go near-zero for demo recordings.

## Why

- `dispute` and `release` sharing one window (rather than each having independent
  timing) means the buyer has exactly one decision point with one deadline — no
  edge case where one option's window has closed but the other's hasn't.
- The two-payment structure in `resolveDispute(sellerAtFault=true)` is deliberate,
  not an implementation detail: it's the literal difference between "escrow" (buyer
  gets their own money back) and "slashable bond" (buyer gets compensated on top of
  that) — the whole reason `SellerBond` exists rather than just building a plain
  escrow contract.
- **Flagged, not fixed**: a `Disputed` job has no timeout rescue if the arbiter
  never calls `resolveDispute` — `Active` jobs have `claimTimeout` as an escape
  hatch, `Disputed` jobs don't. Acceptable for the hackathon since the arbiter is
  the same already-disclosed centralized deployer wallet, but documented explicitly
  in `plans/08-disclosures.md` rather than left as a silent gap. A production
  version would need an arbiter-side timeout or fallback resolution path.

## Testing

32 tests in `JobEscrow.t.sol` (73 total across both contracts), all passing
(`forge test`):

- `dispute`: records evidence hash and flips status with no fund movement; reverts
  for a non-buyer caller, an already-non-Active job, and a call past the response
  window
- `resolveDispute`: seller-at-fault path asserts the buyer receives *both* payments
  and the seller's stake permanently shrinks; not-at-fault path asserts it pays out
  identically to `release()`; reverts for a non-arbiter caller and a job that was
  never disputed
- `claimTimeout`: a stranger (not buyer or seller) can trigger it after the window;
  reverts before the window elapses and on a non-Active job
- `setMinBondRatioBps`/`setResponseWindow`: emit-and-apply happy path; only owner;
  the two new caps hold

## Audit fixes (added 2026-08-03, same branch)

Ran a manual security audit on this contract before moving to Phase 3. Reentrancy
checked out clean (state updates always precede external calls; USDC's plain
ERC-20 `transfer` has no recipient hooks to exploit). Three real findings, all
fixed here:

1. **`responseWindow` wasn't snapshotted per job.** `release`/`dispute`/
   `claimTimeout` all read the *live* `responseWindow` state variable, not a value
   captured at job creation — inconsistent with `reservedBond` (explicitly fixed at
   creation, invariant 1) and with `SellerBond.pendingWithdrawal.unlockTime`, which
   snapshots for exactly this reason. An owner shortening `responseWindow` mid-flight
   (even just for a demo) would retroactively close a buyer's dispute window early,
   or retroactively extend a seller's bond lockup. **Fix**: new `Job.responseDeadline`
   field, computed once at `createJob()` time, read everywhere instead of recomputed.
2. **`completionDeadline` had no upper bound.** Both `completionDeadline` and
   `responseWindow` are `uint64`; a deadline near `type(uint64).max` makes their sum
   overflow and revert — in `release`, `dispute`, `claimTimeout`, and transitively
   `resolveDispute` (which requires `dispute()` to have succeeded first). That's
   every exit path from `Active`, so the job's escrowed funds and the seller's
   reserved bond would be **permanently locked with no recovery**. Not far-fetched
   either: this codebase's own tests already use `type(uint256).max` as a "no real
   limit" sentinel for USDC allowances — the same convention applied to a deadline
   hits this exactly. **Fix**: `MAX_JOB_DURATION = 365 days` cap in `createJob`, not
   owner-settable (a structural safety bound, not a risk parameter like
   `minBondRatioBps`/`responseWindow`).
3. **`minBondRatioBps = 0` was documented as a valid demo/testing configuration but
   didn't actually work.** `createJob`'s call to `sellerBond.reserve(agentId, 0)`
   always reverted when `reservedBond` computed to zero, since `SellerBond` rejects
   zero-amount calls on `reserve`/`releaseReservation`/`slash`. **Fix**: guarded
   every `SellerBond` call in `createJob`/`release`/`resolveDispute`/`claimTimeout`
   behind `reservedBond > 0`, so a 0%-ratio job now runs its full lifecycle —
   creation, release or dispute, resolution — without ever touching `SellerBond`.
   This makes the documented configuration actually true, rather than just
   correcting the comment to admit it wasn't.

7 new tests cover all three fixes directly (in addition to the 32 above): a
shortened `responseWindow` provably doesn't affect an already-created job's
`release`/`claimTimeout` behavior; a deadline beyond the cap reverts (including the
`type(uint64).max` sentinel scenario specifically); a deadline exactly at the cap
still succeeds (no off-by-one); and a full create → release and create → dispute →
resolve(sellerAtFault=true) lifecycle both succeed end-to-end at `minBondRatioBps =
0` with `SellerBond.reserved` never moving. 80 tests total across both contracts,
all passing.
