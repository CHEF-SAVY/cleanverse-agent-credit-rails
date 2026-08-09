# PR message — feat/jobescrow-skeleton

**Push-ready.** (This branch briefly needed a local-only merge of
`feat/sellerbond-reserve-slash` so tests could run against a real
`reserve`/`releaseReservation` instead of empty stubs — now that PR #5 is merged,
the branch has been rebased onto current `main` and that merge commit is gone.
Diff is clean: just `JobEscrow.sol`, `ISellerBond.sol`, and its test file. 56/56
tests passing, `forge fmt`/`build` clean.)

Copy the Title into GitHub's title field (it otherwise auto-fills from the branch
name), and everything below the line into the description.

Title:

JobEscrow: skeleton, setSellerBond, createJob, and release with tests

---

PR: feat/jobescrow-skeleton → main

Title: JobEscrow: skeleton, setSellerBond, createJob, and release with tests

## What

Two commits: the full `JobEscrow.sol` skeleton (state, events, errors, all function
signatures), then the first real implementation slice — `setSellerBond`,
`createJob`, `release` — wired to a real `SellerBond` (not mocked; only the
Identity Registry and USDC are mocked).

- **`ISellerBond`** — new interface for the calls `JobEscrow` makes into
  `SellerBond`. Safe to hand-write in full since it's our own already-implemented
  contract, unlike `IIdentityRegistry` which needed the real Arcscan ABI.
- **`VALIDATION_REGISTRY`** kept as a raw `address`, not a typed interface — the
  real ABI hasn't been pulled from Arcscan; wiring any calls into it is Phase 3.
- **Three owner-only setters added beyond the plan's original Functions list**:
  `setSellerBond` (one-time wiring for the circular deploy dependency),
  `setMinBondRatioBps`, `setResponseWindow` — all three were implied by the plan's
  state-section prose but missing from its enumerated function list, same gap
  class as `SellerBond`'s `setWithdrawalTimelock`. `plans/03-job-escrow.md` updated
  to list them explicitly.
- **`createJob`** snapshots `sellerPayoutAddress` via `identityRegistry.ownerOf()`
  at creation (not re-read at payout), computes `reservedBond = amount *
  minBondRatioBps / 10000`, calls `sellerBond.reserve()`, then pulls `amount` USDC.
  No duplicate ratio check — `SellerBond.reserve()`'s own revert is what enforces
  sufficient bond.
- **`release`** pays the seller in full, calls `sellerBond.releaseReservation()`,
  and — per invariant 4 in the plan — only succeeds up to `completionDeadline +
  responseWindow`, even though `dispute`/`claimTimeout` don't exist yet, so it
  won't need revisiting when they land.

## Why

- `sellerPayoutAddress` snapshots at creation, not payout: a buyer commits to a
  specific counterparty when the job is created, and re-reading `ownerOf()` at
  payout would let a bad actor launder a payout through an NFT sale mid-job. This
  deliberately disagrees with `SellerBond.completeWithdrawal`, which pays the
  *current* owner — a withdrawal is the seller's own money moving on their own
  initiative, not a buyer's already-committed payment.
- `release` enforcing the response window now (rather than waiting until
  `claimTimeout` exists) keeps the "mutually exclusive by construction" property
  from invariant 4 true from the moment either function exists, instead of having
  a window where it's temporarily false.

## Testing

15 new tests (56 total across both contracts), all passing (`forge test`):

- `setSellerBond`: wires the pointer and emits; only owner; reverts if already set
- `createJob`: reserves bond and pulls USDC (full struct + balance assertions);
  sequential jobIds; reverts on zero amount, past deadline, unwired `SellerBond`,
  insufficient bond (propagated from `SellerBond.reserve()`, not duplicated), and
  a nonexistent seller agent (via `ownerOf`'s own revert)
- `release`: pays the seller and clears the reservation; succeeds immediately
  after creation (before the deadline itself, matching "any time up to deadline +
  responseWindow"); reverts for a non-buyer caller, an already-released job, and a
  call past `completionDeadline + responseWindow`
