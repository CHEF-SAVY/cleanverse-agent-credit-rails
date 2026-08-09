# PR message — feat/jobescrow-validation-registry

Copy the Title into GitHub's title field (it otherwise auto-fills from the branch
name), and everything below the line into the description.

Title:

JobEscrow: wire ERC-8004 Validation Registry (Phase 3, contracts-only)

---

PR: feat/jobescrow-validation-registry → main

Title: JobEscrow: wire ERC-8004 Validation Registry (Phase 3, contracts-only)

## What

Wires the real ERC-8004 Validation Registry into `JobEscrow.sol` — the last piece
of `CLAUDE.md`'s spec: "wire `release` and `resolveDispute` to also write an
attestation there." Contracts-only; the backend half (seller's real
`validationRequest()` call, replacing the `zeroHash` placeholder in
`lib/x402.ts`) is the immediate next PR, before Phase 4 deploy.

- **`IValidationRegistry.sol`** — new interface, `validationResponse` and
  `getValidationStatus` only (not `validationRequest` — `JobEscrow` never calls
  it, only the seller does, off-chain). Signatures verified straight against
  `ValidationRegistryUpgradeable`'s source on Arcscan, re-confirmed live
  2026-08-06 (not reused from days-old notes).
- **`isValidationRequestValid(requestHash, sellerAgentId)`** — new public view.
  `try/catch`-wraps `getValidationStatus` (which reverts for an unknown hash, not
  a safe zero-returning getter) and checks `validatorAddress == address(this) &&
  agentId == sellerAgentId`, returning `false` on any revert or mismatch instead
  of reverting itself. Serves two callers: `createJob`'s hard gate, and it's
  public so off-chain monitoring can call it directly as a registry health check.
- **`createJob`'s hard gate** — when `validationRegistryEnabled`, rejects with a
  dedicated `ValidationRequestInvalid` error if `isValidationRequestValid` returns
  false. Deliberately not a `try/catch`-swallow: a revert here can't be told apart
  from "seller never registered" vs. "registry is down," so silently continuing
  would make the check meaningless. `validationRegistryEnabled` (see next bullet)
  is the actual answer to a long registry outage.
- **`setValidationRegistryEnabled(bool)`** — `onlyOwner` kill switch, no timelock
  (unlike the withdrawal/dispute timelocks elsewhere): low blast radius if
  compromised, and the whole point is being flippable in one transaction the
  moment the registry misbehaves.
- **`_attestValidation(...)`** — internal helper, `try/catch`-swallows
  `validationResponse` and is a no-op entirely when `validationRegistryEnabled` is
  false (skips the external call, not just its failure). Wired into all three
  exit paths:

  | Call site | `response` | `responseHash` | `tag` |
  |---|---|---|---|
  | `release()` | 100 | `bytes32(0)` | `"RELEASED"` |
  | `resolveDispute(true)` | 0 | `job.evidenceHash` | `"SELLER_AT_FAULT"` |
  | `resolveDispute(false)` | 100 | `bytes32(0)` | `"DISPUTE_RESOLVED_SELLER"` |
  | `claimTimeout()` | 50 | `bytes32(0)` | `"TIMED_OUT"` |

- **`MockValidationRegistry.sol`** — new test mock, faithfully implements all
  three real functions (including `validationRequest`, even though `JobEscrow`
  itself never calls it, so tests can set up state exactly the way a real seller
  would): global `requestHash` uniqueness, revert-on-unknown-hash, and
  `validationResponse` restricted to the named validator.
- **`ArcForkIntegration.t.sol`** — new fork test, forks live Arc testnet via the
  `arc_testnet` named endpoint in `foundry.toml`. Pre-deploy smoke test, not a
  unit-test replacement — run manually before Phase 4
  (`forge test --match-contract ArcForkIntegration`), excluded from CI's default
  `forge test` run (see CI change below).

## Why

- **`response = 50` for `claimTimeout`, not 100.** A timeout means the buyer
  simply never responded — not that delivery was confirmed good. Scoring it
  identically to a real `release()` would overclaim quality nobody actually
  verified; 50 reads as "indeterminate" on the registry's 0–100 scale. Easy to
  change if the wrong call.
- **`resolveDispute(sellerAtFault=true)` passes the buyer's real `evidenceHash`
  as `responseHash`**, not `bytes32(0)` like the other three call sites — that's
  what makes the at-fault attestation genuinely content-addressed and checkable
  by other systems, the actual point of wiring ERC-8004 in at all.
- **One error (`ValidationRequestInvalid`), not three.** Considered separate
  errors for "not found" / "wrong validator" / "wrong agent," but the real goal
  is just letting off-chain monitoring tell "registry-related `createJob`
  failure" apart from an unrelated bad-input revert — one distinct error type is
  enough for that; three would be unused precision.
- **A previously-unverified assumption turned out wrong, and the fork test is
  what caught it.** Prior research assumed `validationRequest()` was
  permissionless. It isn't — the real registry requires `msg.sender` to be
  `agentId`'s owner or an approved operator (verified straight from source: an
  `ownerOf`/`isApprovedForAll`/`getApproved` check, `revert("Not authorized")`
  otherwise). Doesn't affect `JobEscrow` itself (it never calls
  `validationRequest`), but it's now a confirmed hard constraint for the backend
  follow-up: the seller's backend must call it from a wallet that actually owns
  (or is an approved operator of) `sellerAgentId`, not an arbitrary relayer.
  `ArcForkIntegration.t.sol` failed loudly against the live registry the first
  time it ran, exactly the value it's designed to add before a real deploy.

## CI change

`--no-match-contract ArcForkIntegration` added to `.github/workflows/ci.yml`'s
test step. `ArcForkIntegration.t.sol` forks live Arc testnet in `setUp()`, so
plain `forge test` now depends on live network access by default — not what a
"pre-deploy smoke test" should gate on every push. Run it explicitly and
separately before Phase 4.

## Audit finding, fixed (2026-08-06, same branch)

Asked to make sure the new logic was solid before considering this done. Manual audit,
adversarial (what can a bad actor do with this mechanism, not just "does it match the
plan") — found one real gap:

**`validationRequestHash` reuse across jobs.** `isValidationRequestValid` is a pure read;
nothing marked a hash as consumed once a job used it. A seller's single registered
`validationRequest` could back *multiple* `createJob` calls. Fund safety wasn't affected
(each job's escrow/bond accounting is independent by `jobId`), but the attestation layer
was: whichever job's `release`/`resolveDispute`/`claimTimeout` attested last would
silently overwrite an earlier job's attestation on the same hash — e.g. job #1's clean
`RELEASED` could get clobbered by job #2's `SELLER_AT_FAULT`. That directly undermines the
one thing Phase 3 exists to provide: a portable, checkable outcome record.

**Fix**: new `validationRequestHashUsed` mapping, checked and set inside `createJob`'s
existing `validationRegistryEnabled` gate block (so the disabled pathway's `bytes32(0)`
placeholder never collides). New `ValidationRequestHashAlreadyUsed` error, distinct from
`ValidationRequestInvalid` — one signals "never registered / wrong validator / wrong
agent," the other signals "registered fine, but already spent on a different job."

2 new tests: reusing an already-claimed hash on a second `createJob` reverts; two
independently-registered hashes for the same seller both succeed (confirms the fix is
"no reuse of one hash," not an overbroad "one hash per seller").

## Testing

103 tests total, all passing (101 before the audit fix above):

- 41 `SellerBond.t.sol` — unaffected, unchanged.
- 56 `JobEscrow.t.sol` (48 before this PR's new tests) — the 4 pre-existing
  gate-adjacent `setValidationRegistryEnabled` tests, plus new coverage:
  `isValidationRequestValid` true/false for registered, unregistered, wrong
  validator, wrong agent; `createJob`'s gate success/fail paths (unregistered
  hash, wrong validator); each of `release`/`resolveDispute`/`claimTimeout`
  still completing correctly when the registry is made to revert on
  `validationResponse` (invariant 3); each exit path's attestation values
  asserted against the mock's stored state, not just "didn't revert"; the kill
  switch also gating the attestation calls, not just the `createJob` gate.
  **All 31 pre-existing `createJob(...)` call sites (written passing
  `bytes32(0)` back when the flag had no effect) needed no changes** — `setUp()`
  gained one line, `jobEscrow.setValidationRegistryEnabled(false)`, restoring
  their exact previous behavior; new tests explicitly re-enable the flag via a
  new `_createJobWithValidHash` helper.
- 4 `ArcForkIntegration.t.sol` — against live Arc testnet: `getValidationStatus`
  really does revert for an unknown hash; a real `validationRequest` naming this
  deployment's `JobEscrow` makes `isValidationRequestValid` return true for the
  matching agent and false for a mismatched one; `validationResponse` really
  does reject a caller that isn't the named validator.
