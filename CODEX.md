# CODEX.md

## 0. Hackathon Context
- **48-hour hackathon.** Build fast, but this still needs to look and feel like a real product, not a hackathon throwaway.
- This is the frontend for a **Cleanverse hackathon** submission — DeFi & Verified Finance track (identity-based credit / gated lending, cross-chain settlement).
- **UX is a top scoring priority** — 15 pts is directly UX & Demo, but polish also bleeds into the 25-pt Build Quality score. Judges are explicitly looking for identity-based DeFi products that feel trustworthy and usable, not just technically functional.

## 1. Project Description
**Identity-Gated Credit for AI Agents** (extends Tripwire)

**Problem:** agent-to-agent payment rails (x402, ERC-8004) are live and scaling fast, but there's no credit layer — identity is out of scope in x402's own design, and ERC-8004 verifies *who* an agent is, not *whether it should be lent to*. Every job today is fully prepaid or fully escrowed.

**Solution:** the agent's operator gets an **A-Pass** (Cleanverse's KYC'd identity pass, bound to a wallet), and the agent draws against an **A-Token**-denominated credit pool sized by A-Pass tier + job history, instead of posting full collateral.

> **Naming — read this before writing any UI copy.** The hackathon rubric calls the platform "CVI·CVA". The actual Cleanverse API (Cooperate API v5.6, mirrored at `docs/cleanverse/api-v5.6.txt`) never uses those words — the primitives are **A-Pass** (identity), **A-Token** (compliance-gated asset), and **Validator compliance pools** (the on-chain gate). Use the **A-Pass / A-Token** names in the product UI: they're what the API returns, so labels line up with real data instead of inventing a vocabulary layer. There is **no** "Agent Skill Framework" and **no** "CCP Protocol" — if you see those in older copy, they were wrong. Do not build a "mandate" screen around them.

**What this means for frontend:** the core user-facing flows are (1) operator onboarding / A-Pass verification, (2) viewing/managing an agent's credit line, (3) lender-side: depositing into the pool and tracking position. The A-Pass step especially needs to feel trustworthy and clear — it's a judged differentiator, not boilerplate KYC.

**Real fields you'll be rendering** (from `POST /query_apass`, so these are the actual shapes): `tier` (0–99, arrives as a *string*), `subTier` (integer), `group` / `subGroup` (1–2 chars), `countries` (array of ISO-3166-1 alpha-2), `status` (**1 = Active, 2 = Frozen**), `expirationTime` (**Unix seconds**), `currentKycHash` (hex). A tier alone is meaningless to a user — surface what it *unlocks* (their credit limit) next to it.

**One UX trap worth knowing:** eligibility is checked by `POST /validator/verify`, which returns **HTTP 200 with `valid: false`** when a user doesn't qualify. That's a normal answer, not an error — it needs a real "here's why you don't qualify yet / here's what to do" state, not an error toast.

## 2. Working Model
- **Codex (you)** — primary builder for the frontend. Own the implementation; drive it forward rather than waiting on step-by-step instruction.
- **Sunday** — design lead, frontend integration input.
- **Isaac** — coordinating overall, contracts/backend handled separately (by Claude — see `CLAUDE.md`). Ask Isaac when you need an API contract, contract address, or endpoint shape that isn't documented yet — don't guess at the backend interface.
- Treat this like production-under-deadline work: real states, real error handling, no permanent placeholder content.

## 3. Tech Stack
- - **Framework:** Next.js 15 (App Router), React 19, TypeScript strict
- **Package manager:** pnpm 9 (workspace: `apps/web`, `contracts/`)
- **DB:** Supabase Postgres + Drizzle ORM (`drizzle-kit push`, no migration files)
- **Auth:** wallet-first — RainbowKit + wagmi + viem; Supabase anon session keyed to address
- **Deployment:** Vercel (web + route handlers), contracts on testnet, Supabase cloud
- **UI:** Tailwind + shadcn/ui`

## 4. Design System
- **Color theme:** `[fill in]`
- **Typography / fonts:** `[fill in]`
- **Design style / references (links, mood):** `[fill in]`
- **Component library (if any):** `[fill in]`
- **Reference mockups/screenshots:** Isaac is dropping reference images in a dedicated folder — path: `[TO BE FILLED — Isaac to confirm the folder path once created]`. Treat this folder as the source of truth for visual direction, above any written description here.

## 5. Core UX Requirements
- Loading, empty, error, and success states required for every core flow — no flow should just "hang" or silently fail.
- Since this is an identity-verified DeFi product: wallet connection and the A-Pass verification step need to feel clear and trustworthy, not like a generic crypto app — this is a judged differentiator, not boilerplate.
- Motion/transitions should feel intentional, not default-browser.
- Mobile/responsive scope: `[confirm — required, or desktop-only for the demo?]`

## 6. Backend / Contract Integration Points
`[Fill in as the backend team (Claude) defines them — API base URL, key endpoints, contract addresses/ABIs, expected request/response shapes. Ask Isaac if something's needed and not here yet.]`

## 7. Anti-Slop Rules
- No lorem ipsum or fake data left in the final build unless clearly labeled as a demo stub.
- Every core flow handles its error states, not just the happy path.
- No unexplained `TODO`s — finish it, cut it, or log it below.

## 8. Known Cuts / Deferred Items (living log)
`[Log anything intentionally cut for time here, with a one-line reason]`

## 9. Additional Notes / Assets
`[Space for anything else — brand assets, reference links, hackathon rules links, submission deadline, etc.]`
