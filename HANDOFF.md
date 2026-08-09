# Handoff — state of the build, and what's left

Written and last updated 2026-08-09. Everything below is on branch
**`feat/cleanverse-rest-client`**.

Read this top to bottom before touching anything. The traps section is not optional — two of them
would fail silently and look like they worked.

---

## 1. What is done and proven live

Not "written" — **executed against the real Cleanverse sandbox and Monad testnet.**

| Area | State |
|---|---|
| Contracts (`CreditPool`, `CreditLine`, `CreditTierGate`, `JobEscrow`) | Written, audited, **150 tests green** |
| Cleanverse REST client (`apps/web/lib/cleanverse/`) | Complete — AES-256-CBC, all endpoints, typed errors |
| A-Pass onboarding | Live. **Contracts can hold an A-Pass** (proven) |
| The 3 credit-band gates | **Deployed and registered on Monad** |
| CCP validator address | **Recovered and verified** — deploy unblocked |
| The identity gate | **Proven**: subTier 0 → no credit, 10 → band-1, 80 → all bands |
| Eligibility API with reasons | Live at `GET /api/operator/[address]` |
| Live rule tuning | Live, repeatable: 2,500 → 500 → 2,500 aUSDC |
| Landing page `/` + console `/live` | Built, renders real data |

### Deployed addresses (Monad testnet, chain 10143)

```
GATE_BAND_1  0x2695C5795F586136eed2F1007bDD31c2b60943bE   subTier >= 10 →    500 aUSDC
GATE_BAND_2  0x4144AF2fdB58e40A9879D3EE449a95b1ecC73591   subTier >= 40 →  2,500 aUSDC
GATE_BAND_3  0x67C37Cbfaa464D430528D9FD5B0a7DDf178BADFa   subTier >= 80 → 10,000 aUSDC
aUSDC        0xaC0893567D43C3E7e6e35a72803df05416C1f20D   6 decimals (verified on chain)
aUSDC policy 0x36489bE45fa84f70a0c2BDB11D824Be608CB12Dd   enforces minTier 5 on recipients
deployer     0xC2Ce96f61a40B54C74f30f1Da73E3b8dcf3e2A2c   funded, 5 MON
```

### Demo wallets (already onboarded, real A-Passes)

| Address | tier | subTier | country | Outcome |
|---|---|---|---|---|
| `0x9999…9999` | — | — | — | No A-Pass → no credit |
| `0x0000…0a0002` | 50 | 10 | — | band-1 → 500 |
| `0x0000…0d0001` | 50 | 40 | **NG** | band-2 → 2,500 — *the rule-change demo target* |
| `0x0000…0a0003` | 50 | 80 | — | band-3 → 10,000 |

---

## 2. Run it

```bash
pnpm install                     # repo root
cd apps/web && ./node_modules/.bin/next dev
```

`apps/web/.env.local` is already populated locally (gitignored) and holds `CLEANVERSE_API_ID`,
`CLEANVERSE_API_KEY`, `CLEANVERSE_ADMIN_KEY`, `GATE_BAND_*`, `POOL_OWNER_PRIVATE_KEY`,
`ASSET_ADDRESS`. `apps/web/.env.example` documents every one.

Sanity check before anything else — all four must be `ok`:

```bash
curl -s localhost:3000/api/cleanverse/health | python3 -m json.tool
```

Verify with `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/eslint .` — **not**
`pnpm exec`, which re-runs install and trips on an ignored build script.

---

## 3. 🚨 Traps — read before writing code

**1. `is_black_list: true` does nothing.** The API accepts it, it confirms on-chain, and
`validator/rules` reads it back correctly — and it restricts nobody. Only the allow-list form
(`is_black_list: false, countries: [...]`) is enforced. Verified both directions. Use
`mode: "allow-only"`.

**2. `add_rule` widens, it does not restrict.** Rules on a pool are **OR**ed. To tighten a band,
use `set_rule`. `add_rule` would look like it worked and do the opposite.

**3. Every recipient of aUSDC needs an A-Pass, including contracts.** `CreditPool` and
`JobEscrow` must be onboarded after deploy or every transfer reverts `NoAPass`. `ensureApass()`
handles it; it is idempotent.

**4. Never cache a compliance verdict.** A cached "approved" is a stale approval. Reads may
retry; writes must not — a retried `set_rule` could apply twice.

**5. Fail closed, always.** An outage or a paused pool denies credit. Never treat an error as
approval. `VALIDATOR_UNAVAILABLE` is a distinct code from a real denial so the UI can say
"couldn't check" rather than "you don't qualify".

**6. Every A-Pass comes back tier 50** regardless of the KYC submitted (measured across 7).
That is why bands gate on `subTier`, which we set. `countries` *is* real KYC output.

---

## 4. Current build state and completed Tripwire frontend

### 4.1 ✅ No longer blocked — the validator address was recoverable

**`CCP_VALIDATOR_ADDRESS=0xaC7e5179C2C7f03f209136886c172eb34F161792`** (Monad testnet).

Found without Cleanverse: `validator/set_rule` returns a `tx_hash`, and that transaction is sent
*to* the validator, so the `to` field on any receipt is the address. Verified three ways before
use — see `contracts/.env` and open-questions §Q1.

**`Deploy.s.sol` is therefore unblocked.** Nothing external is outstanding. Remaining sequence:

1. `forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast`
   (reuse the three gates already deployed — pass their addresses to `setTierBands`, do not
   redeploy them)
2. Onboard `CreditPool` and `JobEscrow` via `POST /api/admin/apass` — **mandatory**, see trap 3
3. Fund the pool with aUSDC
4. Run borrow → job → repay end to end for the first time

### 4.2 UI/UX work completed in the latest pass

The product name is now **Tripwire** everywhere in the active landing page, live console and page
metadata. The previous `ledgerline` placeholder is intentionally mentioned only in this handoff.

Both `/` and `/live` were redesigned and visually checked at desktop and mobile widths:

- Reduced the oversized presentation: the content frame is now `1120px`, headline and body scales
  are smaller, labels are tighter, cards have less padding, and the live console is substantially
  denser. Do not restore the old billboard-sized type without an explicit design decision.
- Rebuilt the hero as a compact two-column composition. The right side is a **System brief**, not
  invented telemetry: it explains the actual A-Pass → verification → band → limit sequence.
- Changed the desktop architecture from a tall stack into a horizontal authority chain with live
  signal movement. Mobile still collapses cleanly to a vertical reading order.
- Tightened the problem, proof/stat, architecture, policy and CTA sections while preserving the
  continuous bordered document frame.
- Improved the live console wallet selector, loading treatment, decision trace, credit cards,
  error state and responsive behavior.
- Added request sequencing to wallet lookups. A slower response from a previously selected wallet
  can no longer overwrite the currently selected wallet's verdict.
- Added the missing live policy demo through `app/live/actions.ts`. It is a deliberately narrow
  server action exposing only two reversible operations on band-2: restrict to GB or reset to the
  checked-in default. `CLEANVERSE_ADMIN_KEY` never reaches the browser.
- The policy control shows separate `Submit + confirm` and `Re-read verdict` phases. The confirmed
  mutation result is **not** treated as the new credit result; the UI reads the validator again.
- Writes are never retried. Read-only policy inspection and eligibility reads may be retried by the
  user.

### 4.3 Reference concepts studied and the design decision

The supplied videos live in the untracked `UI_DESGIN_IDEA/` directory (the spelling is the current
directory name). They are source material supplied by the user; do not delete, rename or commit
them without asking.

- `factory.mp4` informed the editorial red/black palette, hard-edged controls, ticker, hairline
  grid and dense technical-document rhythm.
- `basedash.mp4` is a 1920×1080, 60 fps, ~128-second product film. Its useful idea is not its
  purple dashboard styling. It tells a transformation story by assembling real-looking interface
  fragments around the message: connect data → generate dashboards → interrogate the database →
  resolve a useful answer. Motion focuses attention, changes application state and creates depth.
- For Tripwire that narrative became: **identity signal → rule evaluation → compliance band →
  credit limit**. We deliberately did not copy generic BI charts, purple branding, decorative 3D,
  or fake live data.

The resulting Tripwire motion language is implemented mostly in `app/globals.css`:

- A low-contrast red ambient field follows pointer position behind both pages.
- A slowly drifting dot field keeps the dark background alive.
- The red hero has a restrained light pass; the System brief floats slightly, scans, and advances
  through its four illustrative steps.
- Sections use native CSS view timelines for short opacity/translate entrances. Browsers without
  view timelines get static content, not hidden content.
- The architecture nodes and wires carry a sequential signal.
- Selected wallets, decision traces and the winning band receive localized scan movement.
- Real pending policy phases use the strongest activity cues because they represent actual state.
- `prefers-reduced-motion: reduce` disables all non-essential animation and pointer tracking.

Two implementation traps were found and fixed during this work:

1. Do not add pre-hydration `IntersectionObserver` class mutations to the server-rendered sections.
   That produced a selective-hydration mismatch. Scroll reveals are CSS view-timeline based now.
2. Do not change `.hero-red > * { z-index: 1; }` back to a blanket `position: relative`. It
   overrides the absolutely positioned hero watermark and creates a large blank red area.

### 4.4 Files changed by the frontend pass

| File | Purpose |
|---|---|
| `apps/web/app/globals.css` | Smaller design scale, ambient field and all motion states |
| `apps/web/app/layout.tsx` | Tripwire metadata and global `MotionController` |
| `apps/web/app/page.tsx` | Applies the ambient page surface to the landing page |
| `apps/web/app/live/page.tsx` | Dynamic initial reads, Tripwire navigation and live policy snapshot |
| `apps/web/app/live/actions.ts` | Narrow server-only inspect/restrict/reset policy bridge |
| `apps/web/components/site/motion-controller.tsx` | Pointer position only; no DOM reveal mutations |
| `apps/web/components/site/hero.tsx` | Smaller hero and animated System brief |
| `apps/web/components/site/live-console.tsx` | Race-safe reads, policy UX, compact results and state motion |
| `apps/web/components/site/primitives.tsx` | Smaller section primitives and reveal hooks |
| `apps/web/components/site/sections.tsx` | Compact content, horizontal architecture and reveal sequencing |

### 4.5 Verification completed after the frontend pass

The following all passed on 2026-08-09:

```bash
cd apps/web
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint app components
./node_modules/.bin/next build
git diff --check
```

The production build completed successfully and emitted 14 routes. `/`, `/live`, and both pages
over the network address returned HTTP 200. The final browser pass showed no hydration warning.

The dev server was restarted after the build and was last available at:

```text
http://localhost:3000
http://192.168.122.223:3000
```

That process is not a deployment; restart it with the command in §2 if the shell/session ended.

The final UI pass did **not** click the policy mutation button because that changes real Monad
testnet/Cleanverse state. The underlying restrict/reset flow had already been proven through the
API as recorded in §1. Claude should explicitly test default → GB-only → default and leave band-2
restored to its default state.

---

## 5. Backend continuation for Claude Code

The frontend is ready for continuation. The next work should be backend and on-chain correctness,
in this order.

### 5.1 Fix the build-time `/api/gateway/balance` warning

`next build` exits successfully, but while generating static pages it logs:

```text
Balance fetch error: During prerendering, fetch() rejects when the prerender is complete.
This occurred at route "/api/gateway/balance".
```

The route catches the exception and returns zero balances, so this is not currently a failed
build. It is still a real lifecycle bug: `apps/web/app/api/gateway/balance/route.ts` performs the
Circle Gateway request and Arc RPC read while Next is probing/prerendering the route. Make the
route explicitly request-bound under Next 16 Cache Components (use the local Next docs and the
same `connection()` pattern already used by `/live` if appropriate), then prove the external calls
do not run during static generation. Do not merely suppress the log.

Also note the harmless build warning that `/home/savychucks/pnpm-workspace.yaml` sits outside this
Git repository. It is unrelated to Tripwire backend behavior; do not rewrite workspace structure
just to hide that warning.

### 5.2 Complete and verify the on-chain deployment

The CCP validator address is recovered, so deploy is no longer externally blocked. Review the
existing, user-owned modifications in `contracts/script/Deploy.s.sol` before changing anything.
Then:

1. Run the deployment sequence in §4.1 while reusing the three existing gate addresses.
2. Onboard the deployed `CreditPool` and `JobEscrow` contracts with `ensureApass()` / the admin
   endpoint. This is mandatory before aUSDC transfers.
3. Fund the pool with aUSDC using a deposit address returned by `query_deposit_address`.
4. Record every final address and transaction hash back in this document and the relevant env
   examples; never place private keys in tracked files.

### 5.3 Run the missing end-to-end lifecycle

Borrow → create/fund job → deliver or dispute → settle → repay has **never been proven as one
continuous flow**. Run it on Monad testnet with real state and capture:

- operator/A-Pass used;
- policy and approved band at the time of borrowing;
- pool balance before and after;
- job and loan identifiers;
- transaction hashes for every write;
- balances and debt after repayment;
- exact revert/error and recovery steps for anything that fails.

Do not weaken fail-closed behavior to make the happy path pass. A validator outage must remain
`VALIDATOR_UNAVAILABLE`, while a genuine ineligibility remains a normal denial.

### 5.4 Backend regression checklist

- Run the full contract suite; the last recorded baseline is **150 passing tests**.
- Smoke-test `/api/cleanverse/health`, `/api/operator/[address]`, policy GET/write, A-Pass onboarding,
  pool registration, Gateway balance and Gateway withdrawal with configured and missing env vars.
- Verify admin routes still reject missing/incorrect `CLEANVERSE_ADMIN_KEY`.
- Prove the UI server action cannot select an arbitrary band, country or raw rule.
- Confirm band-2 is restored after the demo even if the UI request disconnects after confirmation.
- Inspect the untracked `contracts/broadcast/` artifacts before deciding whether any belong in Git.
- Test the Travel Rule export (`downloadTravelRule` is wrapped but still unproven).

---

## 6. Working tree ownership — do not wipe this

The working tree is intentionally dirty. Preserve it; do not reset or overwrite it wholesale.

- `contracts/script/Deploy.s.sol` was already modified outside the frontend work. Treat it as
  user/backend work and inspect its diff before editing.
- `contracts/broadcast/` is untracked deployment output and also predates the frontend work.
- `UI_DESGIN_IDEA/` contains user-supplied video references and is untracked.
- The files listed in §4.4 are the completed frontend pass and are not yet committed.

Use targeted patches. Never run `git reset --hard`, `git checkout -- .`, or bulk cleanup commands.

---

## 7. Naming

The product name is **Tripwire**. "Ledgerline" was the original placeholder and has been removed
from the UI and metadata.

---

## 8. Where the reasoning lives

- `docs/backend-integration-plan.md` — objectives, the standards being followed, and why
- `docs/cleanverse/open-questions.md` — what is blocked, what was answered, what to report back
- `CLAUDE.md` §8 — decisions and deliberate cuts
- Commit messages on this branch carry the evidence for each finding; they are worth reading
  rather than skimming.
