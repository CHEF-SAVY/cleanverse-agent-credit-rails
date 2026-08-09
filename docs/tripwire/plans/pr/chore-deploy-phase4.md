# PR message — chore/deploy-phase4

Copy the Title into GitHub's title field (it otherwise auto-fills from the branch
name), and everything below the line into the description.

Title:

Deploy JobEscrow + SellerBond to Arc testnet (Phase 4)

---

PR: chore/deploy-phase4 → main

Title: Deploy JobEscrow + SellerBond to Arc testnet (Phase 4)

## What

The last piece before the two demo runs and README — deploying the real, permanent
`JobEscrow` and `SellerBond` contracts. New `contracts/script/Deploy.s.sol`: one
`forge script --broadcast` run, three ordered transactions from the same wallet — deploy
`JobEscrow`, deploy `SellerBond` with `JobEscrow`'s address baked in as `immutable`, call
`setSellerBond()` to complete the circular wiring (same sequence documented in
`JobEscrow.setSellerBond`'s own doc comment).

Deployed and verified on Arcscan:
- `JobEscrow`: `0x550c28Ec54A89e430887230C07C34FECc3F590Cf`
- `SellerBond`: `0x2695C5795F586136eed2F1007bDD31c2b60943bE`
- Owner / `ARBITER` (both contracts): `0xC2Ce96f61a40B54C74f30f1Da73E3b8dcf3e2A2c`

## Why

- **Addresses re-confirmed live immediately before deploying**, not reused from the
  days-old table in `01-research-and-decisions.md` — USDC and both ERC-8004 registries
  checked against `docs.arc.io` and Arcscan's contract API same-day.
- **The deployer wallet is a fresh, dedicated wallet — not the buyer or seller wallet.**
  Confirmed via explicit discussion before deploying: whichever wallet deploys becomes
  the permanent `owner` of both contracts and `JobEscrow`'s immutable `ARBITER` (neither
  contract has a `transferOwnership` function — one-time, unchangeable choice, confirmed
  during the pre-deploy audit). Using the buyer or seller's own wallet as arbiter would
  make the arbiter literally one of the two parties to every dispute it resolves,
  undercutting the disclosed "single arbiter, centralized-for-now" trust model. A fresh
  wallet keeps that model at least internally coherent.
- **Dry-run before broadcast** (`forge script` without `--broadcast`) caught nothing —
  clean simulation, correct constructor args, before any real transaction was sent.

## Testing

- Both contracts verified on Arcscan (`--verify --verifier blockscout`), confirmed
  `Pass - Verified` for both, not just trusting the CLI's exit code.
- Sanity-checked on-chain post-deploy: `jobEscrow.sellerBond()` returns the exact
  `SellerBond` address above (confirms `setSellerBond` actually landed), `owner()` and
  `ARBITER()` both return the deployer address as expected.
- Does **not** yet include an actual job end-to-end — that's the two demo runs, the next
  piece of work.
