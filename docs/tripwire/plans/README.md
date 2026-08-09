# Tripwire — build plans

This folder is the actionable, modular breakdown of how Tripwire gets built. It exists
separately from `PROJECT_OVERVIEW.md` (the pitch-level summary) and `IMPLEMENTATION_NOTES.md`
(the sourced research reference) at the repo root — those explain *what* Tripwire is and
*why* each design decision was made; this folder is *how* we actually build it, broken into
pieces small enough to review, confirm, and implement one at a time without losing track of
where we are.

## Why it's split this way

One giant plan file invites the same problem as one giant contract: you can't hold it all in
your head at once, so mistakes hide in the parts you skimmed. Each file below covers exactly
one module or phase. Read one, agree on it, implement it, get its tests green, then move to
the next. Don't jump ahead — a later file sometimes assumes an earlier one's interface is
already settled.

## Files, in the order they should be read/built

| # | File | Covers | Depends on |
|---|---|---|---|
| 1 | [`01-research-and-decisions.md`](01-research-and-decisions.md) | Confirmed facts about Circle Gateway, ERC-8004, Paymaster, Arc that override the original spec's assumptions, plus the design decisions already locked in against them | — |
| 2 | [`02-seller-bond.md`](02-seller-bond.md) | `SellerBond.sol` — state, functions, invariants, open questions | 1 |
| 3 | [`03-job-escrow.md`](03-job-escrow.md) | `JobEscrow.sol` — state, functions, invariants, open questions | 1, 2 |
| 4 | [`04-backend-integration.md`](04-backend-integration.md) | Rewiring the forked `arc-nanopayments` buyer/seller agents onto the contracts | 2, 3 |
| 5 | [`05-testing.md`](05-testing.md) | Foundry test plan for both contracts, including the fork-test pre-deploy gate | 2, 3 |
| 6 | [`06-build-sequence.md`](06-build-sequence.md) | Phase-by-phase build order (Phase 0–7) with a status checkbox per phase — the single source of truth for "where are we right now" | all above |
| 7 | [`07-demo-and-deployment.md`](07-demo-and-deployment.md) | Deploy steps, both demo runs, and the verification checklist before either | 6 |
| 8 | [`08-disclosures.md`](08-disclosures.md) | Honest-disclosure notes that must land in the final README | — |

## Status as of 2026-07-26 (evening)

**Phase 0 is complete; Phase 1 has started.** The repo is live at
`github.com/tripwire-labs/Tripwire` (single flattened repo; CI green on every branch), the
baseline x402 flow is verified end-to-end on Arc testnet (two upstream fixes were needed —
see `06`), buyer/seller agents are registered on the Identity Registry, and the
`SellerBond.sol` skeleton is merged (PR #1). Current position: implementing `SellerBond`
function-by-function on change-scoped branches, starting with `feat/sellerbond-deposit`.
This folder itself is **local-only** (gitignored) — the step-by-step guide lives on disk,
not on GitHub, per the project owner's choice.

## Working rules for this folder

- **Confirm before implementing.** Each contract/module file gets read and agreed on before
  its corresponding code is written — per the project's stated working style (skeleton first,
  talk it through, implement incrementally).
- **Flag assumptions, don't silently resolve them.** Every file below has an "Open questions /
  assumptions" section where anything not yet independently verified is called out explicitly
  rather than guessed at.
- **Update `06-build-sequence.md`'s checkboxes as phases complete** — that file is the one
  piece of ground truth for progress; don't let it drift out of sync with what's actually
  been built.
- **Nothing gets committed/pushed until the relevant plan file is confirmed.** These plans are
  the checkpoint gate the project owner asked for before code lands in git history.
- **One branch per change (updated 2026-07-26, supersedes the earlier branch-per-plan
  scheme).** Every discrete change — a feature slice, a fix, a doc update, even a
  modification to something an earlier branch introduced — gets a **fresh branch cut from
  the latest `main`**, goes up as a PR, must pass CI, and is merged then deleted. No
  long-lived branches. This keeps `main` always-working and makes bug hunting clean: each
  merge on `main` is one small reviewable change, so a regression points at exactly one PR.
  - Branch naming: `feat/<scope>-<what>` for features (e.g. `feat/sellerbond-deposit`),
    `fix/<what>`, `docs/<what>`, `chore/<what>`.
  - A plan is implemented as a *sequence* of these small branches (e.g. plan 02 becomes
    `feat/sellerbond-deposit`, `feat/sellerbond-withdrawals`, `feat/sellerbond-slash`),
    each merged when its own tests are green.
  - Update `06-build-sequence.md`'s checkboxes in the same branch as the work they track.
