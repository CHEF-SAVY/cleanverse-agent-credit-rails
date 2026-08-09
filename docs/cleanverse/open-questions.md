# Open questions & blockers — Cleanverse integration

Living log. Written down rather than left in chat, because the last round of these was lost.
Last updated 2026-08-09.

---

## 1. Funding — needs Isaac, not Cleanverse

Fund this address with **Monad testnet MON**:

```
0xC2Ce96f61a40B54C74f30f1Da73E3b8dcf3e2A2c
```

| | |
|---|---|
| Chain | Monad testnet, chain ID `10143` |
| RPC | `https://testnet-rpc.monad.xyz` |
| Balance as of 2026-08-09 | **0 MON — not yet funded** |
| Role | Deployer; `Ownable.owner()` of `CreditPool` and every `CreditTierGate`; `JobEscrow`'s **immutable** `ARBITER` |
| Key location | `contracts/.env` → `DEPLOYER_PRIVATE_KEY` (gitignored) |

This wallet is load-bearing in three ways at once, and `ARBITER` is immutable — it cannot be
rotated after deploy without redeploying `JobEscrow`. It is also the key Cleanverse's
`/validator/register` signature is checked against, since that endpoint verifies an EIP-191
`personal_sign` against the subject contract's `owner()`.

Nothing deploys until this has gas.

---

## 2. Questions for Cleanverse — genuinely blocking

### Q1. Where is `IAPassComplianceValidator` deployed, and is Monad among them? 🚨

**This is the one that can sink the architecture.** We need a `CCP_VALIDATOR_ADDRESS` for
`Deploy.s.sol`, and it does not exist in anything we've been given:

- Both CCP PDFs contain **zero** contract addresses — grepped, nothing.
- The CVA guide names supported networks as *"EVM (Ethereum, Base, BSC, Arbitrum, Polygon,
  etc.)"* — **Monad is not listed**, and its only concrete code sample points at Base mainnet
  (`https://mainnet.base.org`).
- The Cooperate REST API *does* list `monad` as supported, and the Monad UAT pair is confirmed
  live. So the two halves of Cleanverse disagree about Monad.

We picked Monad precisely because Cleanverse has no Arc support. If the on-chain validator isn't
on Monad, the identity gate — the entire 30-point primitive — is unreachable there too, and we'd
be looking at Base instead.

**Ask:** the deployed address of `IAPassComplianceValidator` on every chain it lives on. If Monad
testnet is not one of them, say so explicitly.

### ~~Q2. Do we have **Issue Member** role?~~ ✅ ANSWERED BY DOING IT — yes

Registered all three credit-band gates via `POST /validator/register` on 2026-08-09, which is
Issue-Member-only. All three succeeded and carry their rules. No need to ask.

### ~~Q3. Is a testnet A-Token actually reachable on Monad?~~ ✅ ANSWERED OURSELVES

**Resolved 2026-08-09 by live API call — see §3 below. `ASSET_ADDRESS` is now set.**

---

## 3. Answered by live API calls, 2026-08-09

Credentials work. Two read-only calls against the UAT sandbox (`api-id` only, no api-key
transmitted — both endpoints are plain JSON, not AES).

### ✅ Monad is fully supported at the A-Token layer. aUSDC is real and live.

`POST /query_deposit_atoken_list {"chain":"monad"}` → `code 0000`:

| What | Address | Verified |
|---|---|---|
| **aUSDC (our `ASSET_ADDRESS`)** | `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` | `symbol() == "aUSDC"`, `decimals() == 6` by `eth_call` on Monad |
| origin USDC | `0x534b2f3A21130d7a60830c2Df862319e593943A3` | listed as the origin token |

aUSDC is at the **same address on Monad and Base** — a deterministic deploy, which makes the
"Base is where this deploys next" pitch cheaper than expected. `ASSET_ADDRESS` is now set in
`contracts/.env`, so that deploy blocker is cleared.

Also discovered: **`POST /faucet`** exists (chain, symbol, depositAddress, amount) and is open to
all three role tiers. We may not need the Circle faucet at all.

### ⚠️ Endpoint names in CLAUDE.md §5 are wrong — corrected

| CLAUDE.md says | Actually exists |
|---|---|
| `query_supported_atoken_list` | **`query_deposit_atoken_list`** |
| `query_transactions` | **`query_txs`** |
| `query_institution_transactions` | **`query_institution_txs`** |

### 🔶 The validator module answers for `chain: "monad"`

`POST /validator/is_register {"chain":"monad", ...}` → `code 0000`, `registered: false`. It
accepts Monad as a chain rather than rejecting it, which is good evidence the compliance validator
**is** deployed there and softens Q1 — but it still doesn't give us the contract address, and
`is_register` is a read. Q1 and Q2 both stand.

`query_apass` is also reachable (returns a clean "apass not found" for our deployer, as expected).

### ❌ The addresses Cleanverse returns are *not* the validator

The token list also returns `accesscore_address` `0x8F118338a1fa41E7Fa86Be19A4e8B99Ed58A6EcC` and
`apass_address` `0xbA82D189540CaC9DC6FF46B6837CaC1BFdEC58B9`, identical on Monad and Base. Both
are live ERC-1967 proxies with real implementations — but **neither answers `complianceVerify`,
`isRegistered`, or `getRulesV2`**; all three revert with empty data. Our interface signatures were
checked against the CCP guide and match it exactly, so this isn't a transcription error on our
side. These are the A-Token engine and the A-Pass registry, not the compliance validator.

**So Q1 cannot be answered by inspection. We still need the address from Cleanverse.**

---

## 3b. Worth reporting back to Cleanverse — `is_black_list` does nothing on-chain

Not a blocker for us (we use the allow-list form), but it is a silent failure and they will
probably want to know.

Setting a validator rule with `is_black_list: true, countries: ["NG"]`:

- `POST /validator/set_rule` returns `0000` and a tx hash
- the transaction **confirms on-chain**
- `POST /validator/rules` reads the rule back exactly as submitted
- and an operator whose A-Pass carries `countries: ["NG"]` **still passes `validator/verify`**

The same band switched to `is_black_list: false, countries: ["GB"]` denies that operator
immediately, so the country data and the rule plumbing both work — only the deny-list *semantics*
are absent.

Consistent with `RuleV2.poolCountryBitmap` superseding the legacy pair: a bitwise AND against a
bitmap of permitted countries expresses an allow-list naturally and a deny-list not at all. The
API accepting a flag it cannot honour is the problem — an error would be far safer than silence.

Measured on Monad testnet, 2026-08-09.

---

## 4. Answered from the docs — no need to ask

### ✅ A-Token transfers **are** recipient-gated. This has consequences.

Previously logged as an open audit item ("ask Cleanverse whether A-Token transfers are
recipient-gated"). The v5.6 docs answer it plainly and repeatedly — compliance rules
*"determine whether a wallet is allowed to **receive**/transfer this A-Token"*, and
`POST /verify_apass` exists specifically to check *"whether receive/transfer is allowed"*, with
error code `3` = *"APass exists but cannot transfer AToken (expired or frozen)"*.

**So: yes, gated on the recipient.** Which means:

1. **The buyer needs an A-Pass**, not just the agent operator. `CreditLine.fundDraw` paying an
   escrow whose buyer can't legally receive AUSDC will revert *inside* `resolveDispute` — the
   same permanent-freeze shape as audit finding #1, with the buyer's escrow stuck alongside it.
   Disputed has no timeout path.
2. This belongs in the **demo script**: every wallet that touches AUSDC needs an A-Pass, and we
   should show that, not trip over it live.
3. Worth considering a `verify_apass` precheck before a job is even accepted, so the failure
   surfaces as a clean "this buyer isn't eligible" instead of a revert deep in settlement.

### ✅ `/validator/grant` is the real path; `/validator/apply` does not exist.

Grepped v5.6: `/validator/grant` appears at lines 283, 3462, 3504 (including a full curl example).
`/validator/apply` — the path another team used in the group chat — appears **zero** times in
either the API docs or the CCP guides. Use `grant`.

---

## 5. Not Cleanverse's problem — ours

- **Design system blanks** in `CLAUDE.md` §6: colour theme, typography, style references,
  component library, and whether responsive is in scope or the demo is desktop-only. Sunday and
  Codex need these; UX is a top-two scoring priority and these are still `[fill in]`.
- **Secret hygiene:** `CLEANVERSE_API_KEY` is the **AES key**, not a bearer token. It must stay
  server-side. It currently lives in the gitignored `contracts/.env` — it must never reach
  `apps/web/.env.example`, any `NEXT_PUBLIC_*` var, or the browser bundle.
