# CLAUDE.md

## 0. Hackathon Context — read this first
- **This is a 48-hour hackathon.** Time is the scarcest resource. Every decision should weigh build-speed against quality — but "fast" is never an excuse to ship broken or embarrassing work (see §6, Anti-Slop Rules).
- **We are optimizing to win**, not just to demo. That means building toward the actual judging rubric below, not toward "looks impressive in a screenshot."
- Our stated priority order: **the first 4 scoring categories**, with **SDK integration depth** and **UX polish** as the two non-negotiables above everything else. If you're ever trading off scope, cut features that don't serve those two before you cut polish on either of them.

## 1. Judging / Scoring Rubric
Track: **DeFi & Verified Finance** (gated lending/AMM protocols, identity-based credit, cross-chain settlement).

- [ ] **Concept & Problem Definition** — 20 pts — priority: ⭐⭐⭐
- [ ] **Depth of CVI·CVA Integration** — 30 pts — priority: ⭐⭐⭐ (top priority, largest single category)
- [ ] **Build Quality** — 25 pts — priority: ⭐⭐⭐
- [ ] **UX & Demo** — 15 pts — priority: ⭐⭐⭐ (top priority per Isaac, punches above its point value)
- [ ] **Scalability Potential** — 10 pts — priority: ⭐ (lowest priority — don't ignore, but don't spend scarce hours here over the four above)

**Additional considerations judges weigh (no separate points, but factored into scoring above):**
- Use Cleanverse primitives meaningfully (not cosmetically)
- Solve real financial infrastructure problems
- Can be piloted with institutions or merchants
- Improve trust, compliance, or interoperability
- Demonstrate clear user value
- Are technically feasible beyond the hackathon

**Isaac's stated priority:** focus hardest on the first 4 categories above. Within those, CVI·CVA integration depth and UX & Demo are the two we should never shortchange, even if it means trimming Concept or general Build Quality scope.

## 2. Project Description
**Identity-Gated Credit for AI Agents** (extends Tripwire)

**Problem:** agent-to-agent payment rails (x402, ERC-8004) are live and scaling fast — x402 has crossed 100M+ cumulative transactions on Base, with tracked usage running into the hundreds of millions of transactions across tens of thousands of active agents, and agentic commerce is projected to grow from roughly $8B in 2026 toward $3.5T by 2031. But there's no credit layer: identity is explicitly out of scope in x402's own design, and ERC-8004 verifies *who* an agent is, not *whether anyone should lend to it*. Every agent-to-agent job today is either fully prepaid or fully escrowed — capital-inefficient and a real adoption blocker.

**Solution:** bind a real, KYC'd **A-Pass** to the agent's operator, register the lending pool as a Cleanverse **Validator compliance pool** so admission is enforced by Cleanverse's own on-chain rules, and let the agent draw against an **A-Token-denominated** credit pool instead of posting full collateral. Borrowing limits are set by A-Pass tier plus on-chain job-completion history rather than pure collateral ratio — this is the track's named "identity-based under-collateralized lending" use case. Every draw-down is traceable to a specific A-Pass snapshot (`currentKycHash` + `expirationTime`), and settlement is exportable through Cleanverse's transaction and Travel Rule reporting.

**Why this is more than KYC-plus-a-pool:** the compliance rule that decides who may borrow (`min_tier`, `allowed_group`, country allow/deny) lives in Cleanverse's Validator contract, not ours. We don't re-implement eligibility — we register our pool, set its rule, and ask `validator/verify`. Tightening lending standards is a rule change on Cleanverse, not a redeploy on our side.

## 3. Team & Working Model
- **Isaac** — contracts + backend, 3+ years of dev experience. Reviewing/guiding, not hands-on-keyboard for most of the build.
- **Claude (you)** — primary builder/shipper for **contracts + backend only**. You own that implementation and are expected to drive it forward, not wait for instructions on every step.
- **Frontend** — being built separately with **Codex** (see `CODEX.md` in the frontend folder), with Sunday on design. Don't build frontend code yourself — coordinate through clearly defined API contracts/interfaces instead.

**Starting point:** Isaac already has **Tripwire** (an escrow + seller-bond settlement project from a prior hackathon) and has created a `cleanverse/` project directory for this build. **First setup step: clone the Tripwire repo into that `cleanverse/` directory** (confirm exact path with Isaac if it's not already obvious in the workspace) and adapt in place — don't scaffold a fresh backend/contracts setup from zero. Reuse whatever escrow/settlement logic fits this project's scope, extend or rip out what doesn't.

**Rules of engagement for you (Claude):**
1. Build like this is going into production under a deadline — not a demo hack. See §6.
2. When a decision affects **architecture, security, UX direction, or scoring strategy**, ask Isaac before committing — don't silently guess on the things that matter.
3. Don't ask about things you can reasonably decide yourself (naming, minor styling calls, boilerplate structure). Use judgment, keep momentum.
4. When you make a time-pressure trade-off (cut scope, stub something, defer a feature), **say so explicitly** so Isaac knows what's been cut and why.
5. Keep Isaac in the loop with short status updates at natural checkpoints (stack scaffolded, SDK integration working end-to-end, core flow demo-able) — don't disappear for hours.

## 4. Tech Stack
- - **Framework:** Next.js 15 (App Router), React 19, TypeScript strict
- **Package manager:** pnpm 9 (workspace: `apps/web`, `contracts/`)
- **DB:** Supabase Postgres + Drizzle ORM (`drizzle-kit push`, no migration files)
- **Auth:** wallet-first — RainbowKit + wagmi + viem; Supabase anon session keyed to address
- **Deployment:** Vercel (web + route handlers), contracts on testnet, Supabase cloud
- **UI:** Tailwind + shadcn/ui`

## 5. The Critical Integration — Cleanverse Cooperate API (CVI·CVA = A-Pass / A-Token)
This SDK integration is the single biggest differentiator for our score (30/100 pts on its own — see §1). Treat it as the highest-priority workstream after core scaffolding is up.

**Important:** this SDK is new enough that you likely have no reliable training knowledge of it. Do not guess at its API surface from pattern-matching to similar identity/KYC SDKs — verify everything against the docs before writing integration code.

- **Docs:** https://docs.cleanverse.com/ — gated behind an invite code (`vhp3FyNV`). The page is a Next.js shell; the real content is an iframe at `/docs/cleanverse`, which needs the `cleanverse_docs_invite=1` cookie that `GET /api/docs/invite/<code>` sets. **Full docs are mirrored in the repo** at `docs/cleanverse/api-v5.6.txt` (extracted text) and `docs/cleanverse/api-v5.6.html` (original) — read those, no network needed.
- **There is no SDK.** Cleanverse ships a **REST API** ("Cleanverse Cooperate API v5.6"), not a package. Nothing to import; every call is HTTP + AES.

> ✅ **CVI = A-Pass. CVA = A-Token. Confirmed by Cleanverse Labs directly** (team chat, 2026-08-08): *"You can generate your own wallet address's **CVI** using the **`generate_apass`** API"*, and *"self-issued **Wrapped CVAs** can manage their own deposit whitelist of institutional addresses using `add_whitelist_for_institutional`"* — verbatim the `/atoken/add_whitelist_for_institutional` endpoint on a Wrapped A-Token. Same objects, two vocabularies, used interchangeably by their own staff. The words CVI/CVA appear **zero times** in the v5.6 docs.
>
> **Agent Skill Framework and CCP Protocol have no counterpart at all** — no endpoint, no field, no mention anywhere. Anything we claimed on their behalf is cut.
>
> **How to talk about it:** write **"A-Pass (CVI)"** on first mention, then follow the audience. Rubric vocabulary in judging copy, API vocabulary in code — naming a real rule field like `min_tier` is *evidence* of integration depth; the brand name alone isn't. All naming in `contracts/` follows the API.

### The real primitives (verified against v5.6)
| What we assumed | What actually exists | What it does |
|---|---|---|
| CVI (identity) | **A-Pass** | KYC'd identity pass bound to a wallet. Attributes: `tier` (0–99, returned as a *string*), `subTier`, `group`/`subGroup` (1–2 chars), `countries` (ISO-3166-1 alpha-2, derived from ID docs), `status` (1=Activate, 2=Freeze), `expirationTime` (Unix seconds), `currentKycHash`. |
| CVA (asset) | **A-Token** | Compliance-gated token. Rules constrain who may hold/receive by tier/group/country; supports pause and institutional deposit whitelists. |
| CCP Protocol / gating | **Validator Compliance** | On-chain **compliance pools**. You register a contract address as a pool, attach a Compliance Rule (`allowed_group`, `allowed_sub_group`, `min_tier`, `min_sub_tier`, `is_black_list`, `countries`), and `POST /validator/verify` answers whether a given wallet satisfies it. **This is the identity-gated-lending primitive** — our credit pool registers as one. |
| Clean Payment Rails | **Common Queries / Travel Rule** | `query_transactions`, `query_institution_transactions`, `download_travel_rule` — the audit-ready record. Plus a **Fiat Ramp** module (quote → hosted widget → order status). |
| Agent Skill Framework | *(nothing)* | No per-agent spend-mandate concept exists. Our `maxDrawPerJob` is **our own** risk parameter — do not pitch it as a Cleanverse feature. |

### 🔑 CCP — the on-chain half (this is the integration-depth story)
Cleanverse Compliance Protocol is a **separate on-chain protocol** from the Cooperate REST API, documented in two PDFs (`docs/cleanverse/`, received 2026-08-08). It appears nowhere in the v5.6 API docs. Confirmed there in writing: **CVI = Cleanverse Verified Identity, CVA = Cleanverse Verified Asset.**

The centrepiece is `IAPassComplianceValidator`, and one member changes our architecture:

```solidity
function complianceVerify(address poolAddress, address userAddress) external view returns (bool);
```

Filed under **"Compliance Verification (No Permission Required)"** — a permissionless view. So our contracts ask Cleanverse's policy engine whether a borrower qualifies **inside the borrowing transaction**. No attestor key, no mirrored snapshot, no staleness. `ApassRegistry` was deleted because of this.

- **`RuleV2`**: `bytes2 allowedGroup; bytes2 allowedSubGroup; uint8 minTier; uint8 minSubTier; uint256 poolCountryBitmap;` — fields within one rule are **AND**; multiple rules on a pool are **OR**; countries are a bitwise-AND against a 256-bit bitmap keyed by ISO-3166-1 **numeric** codes.
- `poolCountryBitmap` **supersedes** the API layer's legacy `is_black_list` + `countries` pair (the API still accepts the old form and converts).
- **Two modes.** *Single-contract* (no REGISTER_ROLE needed; their doc names our exact use case: *"Lending protocols: verify borrower CVI to filter compliant borrowers"*) and *Factory* (REGISTER_ROLE, batch-manages pools, "high-tier express lanes").
- **How we size limits without an oracle:** each credit band is a `CreditTierGate` — a tiny registered contract carrying its own `RuleV2.minTier`. `CreditLine.creditLimit()` calls `complianceVerify` per gate and takes the **highest passing band**. We never learn anyone's tier, which is all `complianceVerify` would tell us anyway. Retuning a band is a rule change on Cleanverse — no redeploy.
- **Fail closed:** `_passesGate` swallows validator reverts into `false`. A paused pool returns error `12027` instead of a verdict, so an outage must deny credit, never grant it.
- **Registration signature:** EIP-191 `personal_sign` over `keccak256(chain + contract_address)`, lowercase hex, no separator. Requires the subject contract expose `Ownable.owner()` — `CreditTierGate` and `CreditPool` both do.
- ⚠️ **Endpoint discrepancy:** REGISTER_ROLE is granted at `POST /api/cooperate/validator/**grant**`. Another team's message in the group used `/validator/apply` — that path does not appear in either the API docs or the CCP guides.
- ⚠️ **Chain conflict, unresolved:** the CVA guide lists supported networks as "EVM (Ethereum, Base, BSC, Arbitrum, Polygon, etc.)" — **Monad is not named**, though the Cooperate API does list `monad`. Our Monad decision is provisional until Cleanverse confirms where `IAPassComplianceValidator` is actually deployed.

### Environment & auth
- Sandbox: `https://uatapi.cleanverse.com/api/cooperate` · Production: `https://api.cleanverse.com/api/cooperate`
- Every request needs an `api-id` header. Optional `X-Request-ID` (UUID) for log correlation.
- **`api-id` and `api-key` must be obtained from Cleanverse** — Isaac, this is the remaining hard blocker on any live call. `api-key` never leaves our server; it is the AES key, not a bearer token.
- **Encryption:** many endpoints take `{"data":"<Base64 ciphertext>"}` — AES/CBC/PKCS5Padding, **fixed IV of 16 zero bytes**, key = Base64-decoded `api-key`, UTF-8. Encrypted: all `/generate_apass`, `/update_status`, all `/atoken/*` writes, and `/validator/{grant,register,set_rule,add_rule,remove_rule,set_paused}`. Plain JSON: all Fiat Ramp, and validator **reads** (`is_register`, `rules`, `verify`, `is_paused`).
- **Roles:** Issue Member (everything) > Gateway Member (A-Pass + Common Queries) > Service Partner (Common Queries only). **We need Issue Member** — Validator Compliance is Issue-Member-only.
- Success is `code: "0000"`. `/validator/verify` returns **HTTP 200 with `data.valid: false`** for an ineligible user — that is *not* an error, don't treat it as one.

### Endpoints we actually use
- `POST /generate_apass` (encrypted) — operator onboarding. Needs `customerId` (**12+ chars, strictly `[A-Za-z0-9]`, no hyphens/underscores**), `expirationTime`, `wallet{address,chain}`; optional `identityDataList[]`, `bankAccountList[]`, `subTier`, `subGroup`.
- `POST /query_apass` — read tier/subTier/group/subGroup/status/expirationTime/countries/currentKycHash for a wallet. Flat response only; no nested `wallets`.
- `POST /validator/grant` + `POST /validator/register` (encrypted, **owner-signed**) — register our `CreditPool` as a compliance pool with its initial rule.
- `POST /validator/verify` (plain) — the gate: does this operator wallet satisfy our pool's rules?
- `POST /validator/set_rule` / `add_rule` / `rules` — tune the lending pool's admission rules live (great demo beat).
- `POST /query_transactions` / `download_travel_rule` — audit trail for the settlement story.

### Integration Style — Backend & Contracts
- **Backend (Node.js)** owns every Cleanverse HTTP call: A-Pass generation at operator onboarding, `validator/verify` before an agent is granted a line, periodic re-query to catch expiry/freeze. It then writes the result on-chain to `ApassRegistry`.
- **Contracts** own credit-limit accounting and the adapted Tripwire escrow/dispute/slash logic. They read the mirrored A-Pass, never re-derive compliance.
- **Why mirror on-chain at all:** the EVM cannot make a REST call, and `validator/verify` is REST-only. `ApassRegistry` is the single seam — the backend attestor key writes A-Pass snapshots, and every draw-down is traceable to one (`kycHash` + `expirationTime`) instead of an unauditable backend say-so at draw time.

### Integration Notes / Gotchas (living log)
- Docs are **v5.6**, dated 2026-07-21 — newer than the v3 the site's `<title>` claims. Trust the in-page revision history.
- `tier` comes back as a **string** (`"26"`), `subTier` as an integer. Parse defensively.
- `/validator/grant` and `/validator/register` need an **EIP-191 `personal_sign` owner signature** over `lowercase-chain-slug + lowercase-hex-address` concatenated with **no separator** (e.g. `base0x742d...beb0`). Cleanverse checks it against the subject contract's `Ownable.owner()` — so **`CreditPool` must expose `owner()`**. Ours does.
- Rule mutations are on-chain writes returning a `tx_hash`; the docs warn to **wait for confirmation before issuing another rule mutation on the same pool**. Serialize them.
- A paused pool makes `verify` fail with `12027` rather than returning `valid` — unpause before verifying.
- Supported chains include `base`, which is where x402 volume lives — good alignment with the §2 pitch.
- 🚨 **Cleanverse does not support Arc.** The supported list is exactly: `solana, base, avalanche, arbitrum, ethereum, polygon, bsc, monad, hashkey, platon`. "Arc" appears **zero times** in the docs. Our contracts are pinned to Arc testnet (inherited from Tripwire), so **the A-Pass gate and the credit stack cannot currently live on the same chain.** Decision pending — see §8.
- **Getting a testnet A-Token to actually use** (from Cleanverse Labs, 2026-08-08): the Monad UAT pair is live. **AUSDC** is an existing A-Token — you can't self-whitelist on it (only self-issued Wrapped CVAs can manage their own institutional whitelist via `add_whitelist_for_institutional`), but you don't need to: call `POST /query_deposit_address` for your deposit address, then use the **Circle faucet** (https://faucet.circle.com) on **Monad or Polygon Testnet**, enter that deposit address, and the A-Pass wallet receives AUSDC. This means the pool can be denominated in a **real A-Token** rather than a mock ERC-20 — a direct §5 depth win, and it retires most of the "single settlement asset" caveat.
- We can also **self-issue our own CVA/Wrapped A-Token** (`/atoken/launch` or `/atoken/launch_wrapped_atoken`) if we want the pool share token itself to be compliance-gated. Higher ceiling, more moving parts — not yet decided.

## 6. UX — Priority, Not an Afterthought
UX quality sits alongside SDK integration as a top scoring priority. Do not treat it as polish to bolt on in the last hour.
- Interaction states (loading, empty, error, success) are required, not optional, for every core flow.
- Motion/transitions should feel intentional, not default-browser.
- Mobile/responsive behavior: `[confirm scope — is a responsive build required, or desktop-only for the demo?]`

### Design System
- **Color theme:** `[fill in]`
- **Typography / fonts:** `[fill in]`
- **Design style / references (links, mood):** `[fill in]`
- **Component library (if any):** `[fill in]`

## 7. Anti-Slop Rules (non-negotiable)
- No fake/placeholder data left in the final build unless explicitly flagged as a labeled demo stub.
- Every core user flow handles its error states — not just the happy path.
- Code should be structured well enough that a third-party developer could read and extend it, not just "works once for the demo."
- Every SDK integration point is verified against actual docs/testing — never assumed.
- No unexplained `TODO`s in submitted code — either finish it, cut it, or log it in §8.

## 8. Known Cuts / Deferred Items (living log)
- **DECIDED 2026-08-08 — deploy target moved from Arc to Monad testnet.** Cleanverse doesn't support Arc, so the Validator compliance pool (the 30-pt primitive) was unreachable there. Monad chosen over Base because the Cleanverse UAT pair is confirmed live and there's a documented path to a real A-Token; Base has the better x402 narrative but no confirmed A-Token/faucet route. ERC-8004 registries verified live at the same `0x8004…` addresses on Monad. Pitch reframe: Base is "where this deploys next", not where the demo runs.
- **Single settlement asset**, now **AUSDC** (a real A-Token) rather than a mock. `JobEscrow`, `CreditPool`, and `CreditLine` all use it. A job priced in USDC against a separately-denominated pool would need a price oracle; inventing one would be fabricated data, so one asset runs end-to-end. Conversion seam noted in `CreditLine.ASSET`.
- **`ASSET_ADDRESS` is unset and blocks deploy.** AUSDC's Monad address comes from `POST /query_supported_atoken_list`, which needs the `api-id`. Deliberately env-read, not hardcoded — an unverified constant here would fail silently at demo time.
- **Pool shares are not an ERC-20.** Non-transferable balances in `CreditPool.sharesOf`. Tokenized LP positions add no rubric points.
- **No interest accrual over time.** Lender yield is a flat facility premium in bps charged per commitment, not a borrow APR. Simpler to reason about and to demo; a real rate curve is post-hackathon.
- **`writeOff` is owner-triggered**, not permissionless-after-grace. Same centralized-for-now trust note as `JobEscrow.ARBITER`.
- ~~**No dedicated unit suites for `CreditPool`, `CreditLine`.**~~ **CLOSED 2026-08-09.** `CreditPool.t.sol` (31 tests) and `CreditLine.t.sol` (53 tests) added alongside the audit below. Suite is now **150 tests**: 62 JobEscrow, 53 CreditLine, 31 CreditPool, 4 fork.
- **A-Pass `group`/`subGroup`/`countries` are mirrored but not yet gated on** in `CreditLine` — only `tier` sizes the limit. The Validator pool rule enforces the rest off-chain at `validator/verify` time, so it isn't a hole, just not duplicated on-chain.

### Contract audit — 2026-08-09
Full read-through of all four contracts, each finding reproduced with a runnable PoC before being
fixed, and every fix now carries a named regression test. **Fixed:**

1. **Lenders could withdraw liquidity backing live commitments** (high). `reserve` checked pool
   solvency going in, but `withdraw` only checked the raw balance, so the invariant could be
   broken a block later — the resulting draw reverted inside `resolveDispute`, freezing the job
   permanently (Disputed has no timeout path) with the buyer's escrow stuck alongside it. Pool now
   reads `CreditLine.totalReserved()` live and refuses to pay out encumbered liquidity
   (`LiquidityEncumbered`, plus `withdrawableLiquidity()` for the UI).
2. **`deposit` could mint zero shares**, taking the lender's assets for nothing → `ZeroShares`.
   Same for `withdraw` burning shares for zero assets → `ZeroAssets`.
3. **Defaulting was free.** `writeOff` restored the agent's full limit immediately, making
   borrow-default-repeat the cheapest strategy available to it. Principal now moves to
   `chargedOff`, which blocks all new borrowing until cleared via `repayChargedOff` — booked as a
   recovery (`CreditPool.recordRecovery`), not a repayment, since the receivable is already gone.
   Job history is *not* restored: paying off a default buys back the right to borrow, not the
   reputation forfeited with it.
4. **Reentrancy guards** on `CreditPool.deposit/withdraw/fundDraw`. The asset is a
   compliance-gated A-Token whose transfer hooks we haven't seen, and `deposit` minted shares
   before pulling assets.
5. **Unknown `agentId` propagated the registry's revert** out of `creditLimit`/`availableCredit`,
   breaking dashboard reads and masking why a reservation failed. Now fails closed to 0, so
   `reserve` reports `AgentNotVerified`.
6. **Missing zero-address checks.** `JobEscrow`'s constructor had none, and `ARBITER` is
   *immutable* — a zero arbiter would permanently brick dispute resolution. Also
   `JobEscrow.setCreditLine(0)` didn't latch the one-shot guard, and `CreditLine` wasn't checking
   `identityRegistry_`.

**Open, not fixed — needs Cleanverse confirmation:** if AUSDC refuses transfers to non-A-Pass
wallets, `fundDraw` sending to a non-compliant buyer would make `resolveDispute` unresolvable —
the same failure shape as finding 1, but unfixable from our side without knowing AUSDC's actual
transfer semantics. **Ask Cleanverse whether A-Token transfers are recipient-gated.** If they
are, the buyer needs an A-Pass too, and that belongs in the demo script.

Also retargeted the fork suite from Arc to Monad (`RegistryForkIntegration.t.sol`) and dropped
the now-unused `arc_testnet` RPC endpoint. Registries re-verified live on chain 10143; the
seller agent is discovered from the registry at fork time rather than hardcoded.

## 9. Additional Notes / Assets
`[Space for anything else — brand assets, API keys locations (never commit real keys), reference links, hackathon rules links, submission deadline, etc.]`
