# Tripwire — Identity-Gated Credit for AI Agents

**Track:** DeFi & Verified Finance · **Chain:** Monad testnet (10143) · **Settlement asset:** aUSDC

---

## The problem

Agent-to-agent payment rails are live and scaling — x402 has crossed 100M+ cumulative
transactions on Base — but **there is no credit layer**. Every agent-to-agent job today is either
fully prepaid or fully escrowed, so an agent must hold the entire value of a job before it can buy
anything.

The two obvious building blocks each solve a different problem:

- **x402** moves money well and puts identity explicitly out of scope. It cannot tell you who is on
  the other side.
- **ERC-8004** proves an agent exists and names its operator. That is *who*, not *whether anyone
  should lend to it*.

Without a real identity behind the wallet there is nothing to underwrite, nothing to report, and
nobody to pursue after a default. So capital sits idle, and under-collateralised credit — the
thing that makes commerce work everywhere else — does not exist for agents.

## The solution

Bind a KYC'd **A-Pass (CVI)** to the agent's operator, register each credit band as a Cleanverse
**Validator compliance pool**, and let the agent draw against an **A-Token-denominated** pool
instead of posting collateral.

The borrowing limit is decided by Cleanverse's on-chain compliance validator plus on-chain job
history — never by us:

```
operator = IdentityRegistry.ownerOf(agentId)                        // ERC-8004
base     = max(band.limit where complianceVerify(band.gate, operator))  // Cleanverse CCP
limit    = base + min(completedJobs × bonus, cap)
```

**The lending rule is not ours.** `CreditLine` asks the validator *inside the borrowing
transaction* and obeys the answer. Tightening lending standards is a rule change on Cleanverse —
no redeploy, no migration, no code change here. That is demonstrated live in the console, where
restricting a band to GB identities drops a Nigerian operator from 2,500 to 500 aUSDC in seconds.

Two properties are structural rather than configured:

- **Identity first, reputation second.** An operator who passes no band has a limit of zero and the
  history bonus is never applied. Reputation modifies a credit line; it cannot conjure one.
- **Fail closed.** An unregistered gate, a paused pool (CCP returns `12027`), or a validator outage
  all resolve to "does not qualify". An outage must deny credit, never grant it.

We also never learn anyone's tier. `complianceVerify` answers yes/no per band, which is all a
credit decision needs — so the protocol holds no personal data it doesn't require.

---

## CVI · CVA integration points

Every item below is **running against the live Cleanverse sandbox and Monad testnet**, not planned.

| # | Primitive | Where | What it does |
|---|---|---|---|
| 1 | **A-Pass (CVI) issuance** — `generate_apass` | `lib/cleanverse/onboarding.ts` | Operator onboarding. Idempotent: `customerId` is derived from the wallet, so a retry cannot mint a second pass. |
| 2 | **A-Pass reads** — `query_apass` | `lib/cleanverse/apass.ts` | Tier, subTier, group, countries, status, expiry, `currentKycHash`. |
| 3 | **Validator compliance pools** — `validator/register` | `lib/cleanverse/pools.ts` | Each of the three `CreditTierGate` contracts is registered as a compliance pool with its own `RuleV2`. Owner-signed (EIP-191 over `chain + address`, checked against `Ownable.owner()`). |
| 4 | **The credit gate** — `validator/verify` + on-chain `complianceVerify` | `lib/cleanverse/eligibility.ts`, `CreditLine.sol` | The actual lending decision. REST for the dashboard's advisory read; the permissionless on-chain view for the authoritative one. |
| 5 | **Live rule tuning** — `validator/set_rule` | `lib/cleanverse/rules.ts` | Changes who may borrow, at runtime. Serialised per pool and confirmed on-chain. |
| 6 | **A-Token (CVA) settlement** — `query_deposit_atoken_list` | `lib/cleanverse/tokens.ts` | The pool is denominated in **real aUSDC**, not a mock. |
| 7 | **A-Token transfer gating** — `verify_apass` | `lib/cleanverse/apass.ts` | aUSDC is recipient-gated; this pre-flights a payout instead of letting settlement revert. |
| 8 | **Audit trail** — `query_txs`, `download_travel_rule` | `lib/cleanverse/reporting.ts` | Every draw-down is traceable to an A-Pass snapshot and exportable. |

**Encryption:** AES-256-CBC, fixed zero IV, PKCS7, key = Base64-decoded `api-key`, implemented in
`lib/cleanverse/crypto.ts`. The api-key is an encryption key, never a bearer token, and the config
loader throws if it is ever evaluated in a browser bundle.

### Three findings we fed back to Cleanverse

Each was measured, not assumed — and each would have failed silently:

1. **`is_black_list: true` is not enforced on-chain.** The API accepts it, it confirms, and
   `validator/rules` reads it back correctly — and it restricts nobody. Only the allow-list form
   works. Consistent with `poolCountryBitmap` superseding the legacy pair.
2. **A-Token transfers are recipient-gated, and contracts are not exempt.** `CreditPool` and
   `JobEscrow` each need their own A-Pass or every transfer reverts `NoAPass`. Proven by issuing a
   pass to a contract address and re-running `canTransfer`.
3. **Every sandbox A-Pass is issued at tier 50** regardless of the KYC documents submitted
   (measured across seven passes, three countries). `countries` *does* vary and is genuinely
   document-derived, which is why the live demo gates on country.

---

## Deployed — Monad testnet, chain 10143

| Contract | Address |
|---|---|
| `CreditTierGate` band-1 (≥ class 10 → 500 aUSDC) | `0x2695C5795F586136eed2F1007bDD31c2b60943bE` |
| `CreditTierGate` band-2 (≥ class 40 → 2,500 aUSDC) | `0x4144AF2fdB58e40A9879D3EE449a95b1ecC73591` |
| `CreditTierGate` band-3 (≥ class 80 → 10,000 aUSDC) | `0x67C37Cbfaa464D430528D9FD5B0a7DDf178BADFa` |
| CCP compliance validator (Cleanverse) | `0xaC7e5179C2C7f03f209136886c172eb34F161792` |
| aUSDC (A-Token, 6dp) | `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` |
| aUSDC compliance policy | `0x36489bE45fa84f70a0c2BDB11D824Be608CB12Dd` |
| ERC-8004 Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Validation Registry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |

All three bands are **registered compliance pools** — verify with `validator/is_register`.

**Why Monad:** Cleanverse does not support Arc at all, which put the compliance validator out of
reach there. Monad has a confirmed live Cleanverse UAT pair, a real A-Token, and the ERC-8004
registries at the same canonical `0x8004…` addresses. aUSDC sits at the *same address on Base*, so
Base is a cheap next step rather than a rewrite.

## Build quality

- **150 contract tests** green, plus a fork suite against the live registries on Monad
- A full contract audit with every finding reproduced by a runnable PoC before being fixed, and a
  named regression test per fix
- Every external address verified by `eth_call` before being hardcoded; unverified values are
  env-read so they fail loudly rather than silently
- No mocked data anywhere in the demo — if Cleanverse cannot be reached, the UI says so and denies

---

## Try it

- **`/`** — the story: problem, architecture, credit ladder
- **`/live`** — a real credit decision, and the rule change that moves it
