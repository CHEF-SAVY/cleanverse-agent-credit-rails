# Backend integration — objectives, standards, and plan

Written 2026-08-09, after the REST client landed and was verified live against the UAT sandbox.

This document answers three questions in order: **what the backend must achieve**, **what "done
properly" means for an integration of this shape**, and **the concrete sequence to get there**.
It also records one risk that could invalidate a core assumption, at the top, because it needs an
answer before the remaining work is worth doing.

---

## ✅ 0. ANSWERED 2026-08-09 — contracts are gated exactly like wallets

**Tested on-chain, not asked.** aUSDC's `_update` hook calls
`policy.canTransfer(token, from, to, amount)`; the policy for aUSDC on Monad is
`0x36489bE45fa84f70a0c2BDB11D824Be608CB12Dd` (from `aUSDC.policy()`). Calling `canTransfer`
directly with `from = address(0)` isolates the recipient check, and the results are unambiguous:

| Recipient | Result |
|---|---|
| EOA without an A-Pass | reverts `NoAPass(0xC2Ce…)` |
| **a contract** (`0x8F11…`) | reverts **`NoAPass(0x8F11…)`** |
| the aUSDC contract itself | reverts `NoAPass(0xaC08…)` |

Selector `0xa6725971` confirmed as `NoAPass(address)`. **Being a contract grants no exemption.**

The rule aUSDC actually enforces, read from the policy — `getRulesV2(aUSDC)`:

```
allowedGroup 0x0000, allowedSubGroup 0x0000, minTier 5, minSubTier 0, countryBitmap 0
```

So: **any address receiving aUSDC needs an A-Pass of tier ≥ 5.** No group or country constraint.

### What this means

`CreditPool`, `JobEscrow`, and every buyer/seller wallet must each hold an A-Pass, or every
transfer reverts. The likely fix is straightforward and does not require the self-issued-token
detour: **`generate_apass` binds a pass to an address, and nothing in v5.6 says that address must
be an EOA.** If a contract address can be issued a pass, we simply onboard our own contracts as
part of deployment.

**Untested and next:** issue an A-Pass to a contract address and re-run `canTransfer`. That is a
write which mints real identity in the sandbox, so it needs an explicit go-ahead rather than being
folded into a read-only check. If it fails, fall back to §0.1 option 3 (denominate in origin USDC).

*Original analysis, kept for the reasoning:*

## 🚨 0.1 The risk as first identified: can a *contract* hold aUSDC?

A-Token transfers are **recipient-gated** — v5.6 is explicit that compliance rules
*"determine whether a wallet is allowed to receive/transfer this A-Token"*, and `verify_apass`
error `3` is "APass exists but cannot transfer AToken".

Our entire settlement layer moves aUSDC into and out of **contract addresses**:

| Contract | Receives aUSDC when |
|---|---|
| `CreditPool` | a lender calls `deposit`, and on every `repay` |
| `JobEscrow` | a buyer funds a job in `createJob` |
| buyer / seller wallets | `release`, `claimTimeout`, `resolveDispute`, `fundDraw` |

A contract cannot complete KYC, so it cannot hold an A-Pass in the ordinary sense. **If aUSDC
requires the recipient to have a valid A-Pass, then `CreditPool.deposit` reverts and nothing in
the system works.** No amount of backend design routes around that.

Three possible resolutions, in descending order of how good the outcome is:

1. **A-Tokens permit contract recipients** (rule evaluation skips non-EOA, or an unset rule is
   permissive). Everything proceeds as designed.
2. **Contracts can be whitelisted** — the institutional deposit whitelist
   (`add_whitelist_for_institutional`) covers this. Note we can only manage that whitelist on a
   **self-issued Wrapped A-Token**, not on AUSDC, which would push us to
   `/atoken/launch_wrapped_atoken` and issue our own compliance-gated token.
3. **Neither** — the pool must be denominated in the origin USDC
   (`0x534b2f3A21130d7a60830c2Df862319e593943A3`) and the A-Token becomes a settlement-edge
   concern only. This weakens the §5 depth story and should be the last resort.

**Action: this goes to Cleanverse as a blocking question alongside Q1.** Until it is answered,
treat "pool denominated in a real A-Token" as provisional. Everything below is written so that
option 3 is a change of one env var and one deploy, not a rewrite.

---

## 1. What the backend must achieve

The pitch is *identity-gated credit for AI agents*: an agent draws against a credit line sized by
its operator's KYC tier plus on-chain job history, instead of posting full collateral. Three
identity/payment systems have to be joined, and **the backend is the only place they can be
joined**, because the EVM cannot make an HTTP call and the REST API cannot read our contracts.

| System | Answers | Lives |
|---|---|---|
| **ERC-8004 Identity Registry** | which wallet operates agent `#N` | on-chain, Monad |
| **CCP `IAPassComplianceValidator`** | is that wallet KYC'd enough to borrow | on-chain, Monad |
| **Cooperate REST API** | issuing A-Passes, setting the rules, the audit trail | HTTP + AES |

`CreditLine.creditLimit()` already performs the on-chain half by itself:

```
operator = IdentityRegistry.ownerOf(agentId)      // ERC-8004
base     = max(band.limit where complianceVerify(band.gate, operator))   // CCP
limit    = base + min(completedJobs × bonus, cap)
```

That is deliberate and it constrains the backend's job. **The backend is not in the borrowing
path.** It never attests, never mirrors an A-Pass on-chain, and cannot make a borrower eligible.
`ApassRegistry` was deleted precisely so no backend key sits between a borrower and their limit.

So the backend's real responsibilities are these five, and nothing more:

1. **Operator onboarding** — issue an A-Pass bound to the operator's wallet (`generate_apass`).
2. **Pool/gate administration** — register each `CreditTierGate` as a compliance pool and attach
   its `RuleV2`; retune those rules later (`validator/register`, `set_rule`, `add_rule`).
3. **Pre-flight checks** — answer "would this succeed?" *before* a user signs a transaction:
   `validator/verify` for eligibility, `verify_apass` for transferability.
4. **Audit & reporting** — `query_txs` and `download_travel_rule` for the settlement record.
5. **Read models for the UI** — compose on-chain reads and REST reads into the dashboard's view.

Everything the backend does is **administrative or advisory**. If the backend is down, existing
credit lines still work; only onboarding and rule changes stop. That is the correct blast radius
and it should stay that way.

---

## 2. What "the standard" looks like for an integration of this shape

Not generic web-app advice — the specific properties this integration needs.

### 2.1 Fail closed, everywhere, on both sides of the seam

The contracts already do this: `_passesGate` and `_operatorOf` swallow reverts into "denied", so a
validator outage or a paused pool denies credit rather than granting it. **The backend must match
that posture**, or the UI will cheerfully tell a user they qualify while the chain refuses them.

`canBorrow()` in `lib/cleanverse/validator.ts` is written this way: a `12027` paused-pool response
and a network timeout both return `{ eligible: false }` with a reason. There is no code path where
an error becomes an approval. **Any new advisory check must follow this rule.**

### 2.2 The advisory/authoritative split must never blur

The dashboard's "you qualify" is a *prediction*; the chain's `complianceVerify` inside the borrow
transaction is the *decision*. These can legitimately disagree — a pass can be frozen between the
two. The correct handling is to make the on-chain revert render as a clear message, not to try to
make the prediction authoritative by caching it. **Never cache a compliance verdict.** A cached
"eligible" is a stale approval, which is exactly the class of bug that made mirrored on-chain
snapshots the wrong design in the first place.

### 2.3 Serialize on-chain rule mutations

`register`, `set_rule`, `add_rule`, `remove_rule` and `set_paused` are on-chain writes returning a
`tx_hash`. The docs warn to wait for confirmation before issuing another mutation against the same
pool. Concurrent rule edits from two dashboard tabs would race. **Requirement:** a per-pool mutex
(a DB row lock or an in-process queue keyed by pool address) plus a confirmation wait before the
next mutation on that pool is accepted. Nothing in the client library fires these in parallel, but
the library cannot enforce ordering across requests — the route handler must.

### 2.4 Idempotency on anything that mints or costs

`generate_apass` creates real KYC'd identity; `/faucet` moves tokens. A double-submitted form must
not create two passes. `customerId` is the natural idempotency key — it is required to be unique,
and `override: false` (the default) makes a repeat a no-op rather than a duplicate. **Derive
`customerId` deterministically from the operator's wallet** (`toCustomerId(address)`) so a retry is
inherently idempotent, rather than generating a random one per request.

### 2.5 Secret handling

The api-key is an **AES key**, not a bearer token. It must be server-only, never `NEXT_PUBLIC_`,
never in a client component, never logged. `getCleanverseConfig()` throws if evaluated in a
browser bundle, which turns a leak into a build/runtime failure instead of a silent compromise.
Rotation should be a config change with no code edit — it already is.

### 2.6 Observability that survives a support conversation

Every request already sends `X-Request-ID`. That id is the only thing Cleanverse can correlate
against their logs when something fails, so it must be **logged with the failure and surfaced in
the error**. `CleanverseApiError` carries `code`, `endpoint` and `requestId` for this reason.
Error **codes**, not message strings, are what callers branch on — messages are not a stable API.

### 2.7 Timeouts, retries, and what is safe to retry

A 20s timeout is set at the client. Retries are **only** safe on reads (`verify`, `query_apass`,
`rules`, token lists). Writes must not be blindly retried: a retried `set_rule` after a timeout
could apply twice on-chain. **Rule: reads may retry with backoff; writes retry only after a read
confirms the write did not land.**

### 2.8 Verify against reality, not against documentation

Already applied twice on this project and both times it mattered: `query_supported_atoken_list`
does not exist, and `accesscore_address` is not the compliance validator despite being the
convenient guess. **Every address is confirmed by `eth_call` before being written down; every
endpoint is confirmed by a live call before being wrapped.** The health route exists so this stays
continuously true rather than true once.

---

## 3. The plan

### Phase A — unblock deployment *(blocked on Cleanverse)*

1. Obtain `CCP_VALIDATOR_ADDRESS` (open question Q1).
2. Confirm **Issue Member** role (Q2).
3. Answer §0 — can contracts receive aUSDC.

Nothing below Phase B can be verified end-to-end until 1 and 3 are answered. Phases B and C can be
*built* now; they cannot be *proven* now, and the difference should be stated plainly rather than
demoed with mocks.

### Phase B — deploy and register *(scripted, one command)*

```
forge script Deploy → CreditPool, JobEscrow, CreditLine, 3× CreditTierGate
   ↓  for each gate, serially, waiting for confirmation between each:
validator/register { contract_address: gate, rule: { min_tier: N }, owner_signature }
   ↓
validator/is_register → confirm all three
validator/verify(gate, testWallet) → prove the gate actually gates
```

Band design (matching `Deploy.s.sol`'s existing limits):

| Gate | `min_tier` | Limit | Meaning |
|---|---|---|---|
| band-1 | 20 | 500 aUSDC | basic verified operator |
| band-2 | 50 | 2,500 aUSDC | enhanced KYC |
| band-3 | 80 | 10,000 aUSDC | institutional |

**Confirmed 2026-08-09.** Note these all sit above aUSDC's own `minTier 5` floor, so anyone who
qualifies for credit can also legally hold the asset — the two rule sets do not contradict.

The tier thresholds are the
single best live-demo beat in the project: raising `band-2`'s `min_tier` via `set_rule` visibly
drops an agent's credit limit on the dashboard with no redeploy, because the rule lives on
Cleanverse. That is the 30-point category made tangible in about fifteen seconds.

This registration flow should be an **idempotent script** (`register-pools.ts`), checking
`is_register` before registering, so it can be re-run safely after a partial failure.

### Phase C — the API surface the frontend consumes

Codex needs a contract to build against. Proposed routes, all server-side:

| Route | Purpose | Notes |
|---|---|---|
| `GET /api/cleanverse/health` | integration status | **built, live, green** |
| `POST /api/operator/onboard` | issue A-Pass for operator wallet | idempotent on `customerId` |
| `GET /api/operator/[address]` | A-Pass status, tier, expiry, usable | `getOperatorIdentity` |
| `GET /api/agent/[agentId]/credit` | limit, available, owed, per-band pass/fail | on-chain reads + gate results |
| `POST /api/credit/preflight` | "would this borrow succeed?" | advisory, fails closed |
| `GET /api/pool/rules` | current rules per gate | drives the rule-tuning demo panel |
| `POST /api/pool/rules` | retune a band | serialized, owner-only, confirmation-waited |
| `GET /api/audit/[txHash]` | Travel Rule / transaction report | the compliance story |

Each needs the four interaction states CLAUDE.md §6 requires — and for this project **"ineligible"
is a first-class success state, not an error state**. An agent that doesn't qualify should get a
clear explanation of which band it missed, not a red toast.

### Phase D — the demo path

The end-to-end story, in the order it should be shown:

1. Operator onboards → A-Pass issued, tier visible.
2. Agent's credit limit appears, attributed to a specific band.
3. Agent takes a job on credit — no collateral posted.
4. Job completes → history bonus raises the limit.
5. **Cleanverse rule is tightened live → the limit drops with no redeploy.**
6. Travel Rule export for the settlement.

Step 5 is the differentiator. Steps 1–4 are table stakes; a judge has seen them before.

---

## 4. What I am explicitly not doing, and why

- **No on-chain A-Pass mirror.** `complianceVerify` is a permissionless view, so mirroring would
  add an attestor key, a staleness window, and a trust assumption in exchange for nothing.
- **No caching of compliance verdicts** (§2.2).
- **No backend key in the borrowing path.** If the backend can't grant credit, it can't be
  compromised into granting credit.
- **No mock A-Pass data anywhere.** Per CLAUDE.md §7, a fabricated tier in a demo is exactly the
  kind of thing that reads as impressive and is worthless. If we cannot get a real pass issued, we
  show the "not onboarded" state and say so.

## 5. Open decisions needing Isaac

1. ~~**Tier thresholds**~~ — **decided: 20 / 50 / 80.**
2. **Go-ahead to issue an A-Pass to a contract address** (§0). This is the test that decides
   whether the pool can be denominated in a real A-Token at all. It is a write that mints identity
   in the sandbox, hence not run unprompted.
3. **Everyone in the demo needs an A-Pass** — buyer, seller, and the contracts. This is now a
   certainty rather than a question, and it expands onboarding from "the agent operator" to
   "every address that touches money".
