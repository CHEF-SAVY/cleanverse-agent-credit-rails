# Handoff — state of the build, and what's left

Written 2026-08-09 ~21:45. Everything below is on branch **`feat/cleanverse-rest-client`**.

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

## 4. What is left

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

### 4.2 Frontend — the immediate work

The two pages exist and render real data. What they still need:

1. **Rule-tuning UI on `/live`.** The API is built and proven (`POST /api/admin/bands/[label]/rule`
   with `{"action":"restrict-country","countries":["GB"]}` and `{"action":"reset"}`). It needs a
   control on the page: a "Compliance restricts this band to GB" button, a pending state while the
   tx confirms (~5–15s, the response carries `txHash` and `confirmed`), then a re-fetch showing the
   operator drop 2,500 → 500. **This is the single most important thing left** — it is the demo.
   Note it is admin-guarded; either proxy it through a server action or expose a demo-only
   unauthenticated variant, but do not put `CLEANVERSE_ADMIN_KEY` in client code.
2. **Mobile.** Written mobile-first-ish but **not tested below 640px.** The band grid, the wallet
   picker and the hero headline all need a pass.
3. **Landing page polish.** The architecture diagram is a vertical stack; the reference has
   horizontal connectors on desktop. Worth 20 minutes if there is time, not before item 1.
4. **A loading state on preset switch** exists (skeleton) — check it doesn't flash on fast
   responses.
5. **`/live` currently has no error boundary** for a total server failure; the console handles its
   own fetch errors but a thrown `evaluateEligibility` on first render is caught and passed as
   `initialError`, which is handled. Verify visually.

### 4.3 Design notes so the UI stays coherent

- Palette, type scale and utilities are in `app/globals.css` under "Design system".
- **Square corners everywhere** (`--radius: 0`). Rounding breaks this language.
- Monospace = machine voice (labels, addresses, codes, verdicts). Sans = human voice.
- One red. Emerald only for "passed"; amber only for "couldn't check".
- Hairline borders are `white/[0.09]`. Sections live inside `.frame`.
- `prefers-reduced-motion` is respected — keep it that way.

### 4.4 After the frontend

- Deploy the rest of the stack once the validator address lands, then onboard `CreditPool` and
  `JobEscrow` (§3 trap 3).
- Fund the pool with aUSDC via `POST /faucet` (needs a deposit address from
  `query_deposit_address`).
- End-to-end borrow → job → repay has **never run**. Budget real time for it; it is where
  surprises live.
- Travel Rule export view (`downloadTravelRule` is wrapped and untested).

---

## 5. Naming

I used **"Ledgerline"** as a working product name in the UI and metadata. It was a placeholder to
avoid shipping "Untitled" — change it freely, it appears in `app/layout.tsx`, `app/live/page.tsx`,
`components/site/hero.tsx` and `components/site/sections.tsx`.

---

## 6. Where the reasoning lives

- `docs/backend-integration-plan.md` — objectives, the standards being followed, and why
- `docs/cleanverse/open-questions.md` — what is blocked, what was answered, what to report back
- `CLAUDE.md` §8 — decisions and deliberate cuts
- Commit messages on this branch carry the evidence for each finding; they are worth reading
  rather than skimming.
