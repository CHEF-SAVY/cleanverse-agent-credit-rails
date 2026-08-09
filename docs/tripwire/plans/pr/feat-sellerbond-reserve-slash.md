# PR message — feat/sellerbond-reserve-slash

Copy the Title into GitHub's title field (it otherwise auto-fills from the branch
name), and everything below the line into the description.

Title:

SellerBond: implement per-job bond reservation and slash with tests

---

PR: feat/sellerbond-reserve-slash → main

Title: SellerBond: implement per-job bond reservation and slash with tests

## What

The `JobEscrow`-only surface of `SellerBond` — the last three functions plus the
`onlyJobEscrow` modifier:

- **`onlyJobEscrow`** — same pattern as `onlyOwner`: the modifier delegates to an
  internal `_checkJobEscrow()` so the check exists once in bytecode
  (forge lint's `unwrapped-modifier-logic` rule). `JOB_ESCROW` is immutable and set
  once at construction, so this is the only gate that ever needs checking.
- **`reserve(agentId, amount)`** — checked against `bondOf(agentId)`, which already
  nets out both existing reservations and any pending withdrawal, so a seller can
  never have more locked against them than they actually posted, across any number
  of concurrent jobs plus an in-flight withdrawal.
- **`releaseReservation(agentId, amount)`** — unlocks bookkeeping only, no token
  movement. Requires `amount <= reserved[agentId]`.
- **`slash(agentId, amount, recipient)`** — requires `amount <= reserved[agentId]`;
  decrements **both** `bondBalance` and `reserved` together and transfers to
  `recipient`, so confiscated stake is gone for good rather than just unreserved.
- All three reject `amount == 0` — not spelled out verbatim in the design doc, but
  added since these are JobEscrow-only calls: a zero-amount call would be a
  caller-side bug, not user input to sanitize, so it should fail loudly.

## Why

- This closes the gap identified in the research doc (finding 5): a ratio check at
  job creation alone can't stop two concurrent jobs from each individually passing
  and then jointly overcommitting the same bond. Real per-job reservation makes
  every job's eventual slash or release unconditionally fundable.
- `slash` can only ever consume what `reserve` actually locked for the job being
  resolved — it structurally cannot touch a seller's free bond or another job's
  reservation.
- No zero-check was in the original plan text for these three, but they're only
  ever called by `JobEscrow`, not directly by users — the same reasoning `deposit`/
  `requestWithdrawal` already apply to user-facing zero amounts extends naturally
  here as defense-in-depth against a `JobEscrow`-side bug.

## Testing

14 new tests (41 total), all passing (`forge test`):

- `reserve`: locks free bond without moving tokens; only `JobEscrow` may call;
  rejects zero; reverts over free bond; respects an already-pending withdrawal
  (the property the reservation design exists for)
- `releaseReservation`: unlocks bookkeeping; only `JobEscrow`; rejects zero; reverts
  over what's actually reserved
- `slash`: transfers to the recipient and decrements both `bondBalance` and
  `reserved`; only `JobEscrow`; rejects zero; reverts over what's reserved
- Explicit invariant test (`test_PendingWithdrawalNeverDipsIntoReservedBond`): once a
  bond is fully reserved, a withdrawal request for even 1 unit reverts — proving
  `bondOf()`'s netting makes this structurally impossible, not just untested
