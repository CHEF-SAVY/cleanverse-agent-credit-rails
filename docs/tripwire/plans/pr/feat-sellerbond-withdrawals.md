# PR message — feat/sellerbond-withdrawals

Copy the Title into GitHub's title field (it otherwise auto-fills from the branch
name), and everything below the line into the description.

Title:

SellerBond: implement timelocked withdrawals with tests

---

PR: feat/sellerbond-withdrawals → main

Title: SellerBond: implement timelocked withdrawals with tests

## What

The withdrawal half of `SellerBond`, plus the owner machinery it needs:

- **`requestWithdrawal(agentId, amount)`** — owner/operator-gated (registry revert
  doubles as the existence check, same as deposit). Snapshots an **absolute**
  `unlockTime` and immediately removes the amount from `bondOf()`, so funds on their
  way out can never back a new job. One request in flight per agent; zero amounts
  rejected (`amount == 0` is the "no request" sentinel, so it must never be
  representable).
- **`completeWithdrawal(agentId)`** — pays out after maturity and clears the request.
  Gated to the agent's owner/operator, but the USDC always goes to
  `ownerOf(agentId)` — an operator can *trigger* the payout, never redirect it.
  Completion only moves custody: free bond already dropped at request time, so
  `bondOf()` is unchanged.
- **`setWithdrawalTimelock(newTimelock)` + `onlyOwner`** — applies to future requests
  only; capped at `MAX_WITHDRAWAL_TIMELOCK = 30 days`. The modifier delegates to an
  internal `_checkOwner()` per forge lint's `unwrapped-modifier-logic` rule.

## Why

- The timelock is the mechanism that stops a seller yanking their stake right before
  a dispute lands — the whole reason the bond is credible collateral.
- Paying `ownerOf` at completion time means a compromised operator key can never turn
  the bond into its own funds, and a mid-timelock agent-NFT transfer pays the *new*
  owner — stake travels with the agent, same as reputation.
- There is deliberately **no cancel**: a mistaken request simply matures and can be
  re-deposited. Cancelability would add a state transition JobEscrow has to reason
  about, for no benefit the timelock doesn't already provide.
- The 30-day cap bounds what a compromised owner key could freeze; deliberately no
  minimum, so demo recordings can run a near-zero timelock (owner-is-centralized is
  already a disclosed trust assumption).

## Testing

18 new tests (27 total), all passing (`forge test`):

- Request: unlock time snapshotted and free bond reduced (gross untouched); operator
  may request; reverts for stranger, zero amount, amount over free bond, second
  request while one is pending, nonexistent agent
- Complete: reverts one second before maturity; pays the owner and clears the request
  at maturity (free bond provably unchanged); operator-triggered completion still
  pays the owner; mid-timelock agent transfer pays the new owner; nothing-pending
  reverts
- Timelock: a global change never affects an in-flight request's snapshot (shortening
  to zero doesn't spring the lock early); a new request after the change uses the new
  value (zero timelock → immediate completion); non-owner and above-cap reverts;
  update event carries old and new values
- Fuzz (256 runs): the accounting identity `free + pending == gross` holds for any
  request size — the invariant that keeps `bondOf()` from underflowing
