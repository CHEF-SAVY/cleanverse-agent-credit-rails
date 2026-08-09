# 2. `SellerBond.sol`

Status: **skeleton implemented and merged (PR #1, 2026-07-26); function bodies in
progress.** Depends on [`01-research-and-decisions.md`](01-research-and-decisions.md) — read
that first, especially the per-job reservation rationale (finding 5).

Conventions adopted 2026-07-26 (the code sketch below predates them):
- Immutables are `SCREAMING_SNAKE_CASE` in the real contract (`USDC`, `IDENTITY_REGISTRY`,
  `JOB_ESCROW`) per forge lint's standard — the sketch's lowercase names map 1:1.
- Custom errors with context args instead of require strings; full natspec + inline
  commentary on every variable/function per the project's study-friendly code rule.
- Each function lands via its own `feat/sellerbond-*` branch + PR, tests alongside.

## Purpose

Sellers post USDC stake against their ERC-8004 `agentId` before they're eligible to take
jobs. Bond is **reserved per job**, not just ratio-checked once at creation — this is the one
meaningful departure from the original spec, closing a gap where concurrent jobs against one
bond could each individually pass a ratio check and then simultaneously be un-fundable at
dispute time.

## State

```solidity
IERC20 public immutable usdc;
IIdentityRegistry public immutable identityRegistry;
address public immutable jobEscrow;          // set once, constructor-only — nothing else can ever slash/reserve

address public owner;
uint64  public withdrawalTimelock = 3 days;   // owner-settable; requests snapshot an absolute unlockTime

struct WithdrawalRequest { uint256 amount; uint64 unlockTime; }

mapping(uint256 => uint256) public bondBalance;          // agentId => gross posted
mapping(uint256 => uint256) public reserved;             // agentId => sum locked by active/disputed jobs
mapping(uint256 => WithdrawalRequest) public pendingWithdrawal;
```

`jobEscrow` is set once in the constructor (or via a one-time `setSellerBond`/`setJobEscrow`
pattern to resolve the circular deploy dependency — see
[`06-build-sequence.md`](06-build-sequence.md) Phase 4) and is never owner-mutable after that.
This is the single fact that makes `slash()` safe: nothing but the one audited contract that
called `reserve()` can ever call `slash()`.

## Functions

- **`deposit(agentId, amount)`** — top-up via `transferFrom`, **restricted to the agent's
  owner/operator** (`isAuthorizedOrOwner`) per the 2026-07-26 decision below; credits
  `bondBalance`.
- **`requestWithdrawal(agentId, amount)`** — only the agentId's owner/operator
  (`identityRegistry.isAuthorizedOrOwner(msg.sender, agentId)`); requires
  `amount <= bondOf(agentId)` (already net of reservations); reverts if a request is already
  pending for that agent.
- **`completeWithdrawal(agentId)`** — requires `block.timestamp >= pendingWithdrawal[agentId].unlockTime`;
  pays out and clears the request.
- **`reserve(agentId, amount)`** — `onlyJobEscrow`; reverts `InsufficientBond` if
  `amount > bondOf(agentId)`; adds to `reserved[agentId]`.
- **`releaseReservation(agentId, amount)`** — `onlyJobEscrow`; reverts if
  `amount > reserved[agentId]`; subtracts from `reserved[agentId]`.
- **`slash(agentId, amount, recipient)`** — `onlyJobEscrow`; requires
  `amount <= reserved[agentId]` — this is the invariant that makes reservation meaningful: a
  slash can only ever consume what was actually locked for a specific job. Decrements both
  `bondBalance` and `reserved`, transfers `amount` to `recipient`.
- **`bondOf(agentId)`** — view: `bondBalance[agentId] - pendingWithdrawal[agentId].amount - reserved[agentId]`.
  This is the true "free" bond both `createJob()`'s reservation call and a seller's own
  withdrawal request see.
- **`setWithdrawalTimelock(newTimelock)`** — `onlyOwner`; updates the timelock applied to
  *future* requests only (in-flight requests keep their snapshotted `unlockTime` —
  invariant 4). This is the "owner-settable" noted on the state variable above, listed
  here explicitly since 2026-07-27 (it was previously implied by the state comment +
  invariant 4 + the PR #1 skeleton, but not enumerated). Why it exists: the timelock is a
  risk parameter (same category as the bond ratio, which the spec says must be
  configurable), and a live demo of a bond exit can't wait out a hardcoded 3 days.
  Capped at `MAX_WITHDRAWAL_TIMELOCK = 30 days` (resolved 2026-07-27): bounds what a
  compromised owner key can freeze; deliberately no minimum, so demos can run near-zero.

## Invariants this contract must uphold

1. `reserved[agentId]` can only ever be moved by `JobEscrow` (`onlyJobEscrow` on `reserve`,
   `releaseReservation`, `slash`) — no owner backdoor.
2. `slash(agentId, amount, _)` always requires `amount <= reserved[agentId]` — a slash can
   never exceed what was locked for the job actually being resolved, and can never touch a
   seller's un-reserved free bond.
3. `bondOf()` nets out both `pendingWithdrawal` and `reserved` — a seller can never withdraw
   funds that are either mid-timelock-request or backing an active job.
4. A withdrawal request's `unlockTime` is snapshotted absolutely at request time — a later
   global `withdrawalTimelock` change (e.g. shortened for a demo) never retroactively affects
   an already-pending request.

## Open questions / assumptions

- Exact `IIdentityRegistry` interface/import path for `isAuthorizedOrOwner` — confirm against
  the real `erc-8004-contracts` ABI once cloned (see finding in
  [`01-research-and-decisions.md`](01-research-and-decisions.md)), don't hand-write the
  interface from memory.
- ~~Whether `deposit()` should be permissionless~~ — **resolved 2026-07-26: restricted** to
  the agent's owner/operator via `isAuthorizedOrOwner`, matching the pitch's "the seller's
  *own* posted stake" exactly and reusing the check the withdrawal path needs anyway. The
  permissionless alternative (third parties may fund a seller's bond) was considered and
  dropped — it's harmless but dilutes the skin-in-the-game story.

## Build order (see [`05-testing.md`](05-testing.md) for matching tests)

Skeleton (function signatures, no bodies) → review together → implement in this order, tests
green after each step before moving on:

1. `deposit` / `bondOf`
2. `requestWithdrawal` / `completeWithdrawal` / timelock
3. `reserve` / `releaseReservation` / `slash`
