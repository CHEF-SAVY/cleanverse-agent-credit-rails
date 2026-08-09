# Contracts — identity-gated credit for AI agents

Foundry project for the credit stack. An agent's borrowing limit is set by its operator's
Cleanverse **A-Pass (CVI)** tier, read live from Cleanverse's own on-chain policy engine, plus
job history earned here. No collateral ratio anywhere in the system.

## The contracts

| Contract | Role |
|---|---|
| **`CreditLine.sol`** | The product. Sizes each agent's limit, tracks commitments, debt, premium and defaults, and is the only contract that talks to the CCP validator. |
| **`CreditPool.sol`** | Where lenders' money lives. Deposits mint shares; draws, premiums and write-offs move the share price. Denominated in an A-Token. |
| **`CreditTierGate.sol`** | One credit band. Holds nothing and does nothing — it exists to *be an address* that Cleanverse has registered against a `RuleV2` (`minTier`, group, country bitmap). |
| **`JobEscrow.sol`** | One job, one escrowed payment. Release on buyer approval, dispute with arbiter resolution backed by the agent's credit line, timeout auto-release so an absent buyer can't grief a seller. |

## How the identity gate works

`IAPassComplianceValidator.complianceVerify(pool, user)` is a **permissionless view** on
Cleanverse's Compliance Protocol. That single fact shapes the whole architecture:

```
creditLimit(agentId) = max(limit of every CreditTierGate the operator passes)
                     + min(completedJobs × bonus, cap)
```

`CreditLine` asks the validator **inside the borrowing transaction**. There is no attestor key,
no mirrored A-Pass snapshot, and nothing to keep in sync — a frozen or expired CVI stops backing
new credit the instant Cleanverse says so. Retuning a band is a rule change on Cleanverse's side,
not a redeploy here.

Two properties are deliberate and load-bearing:

- **Identity first, reputation second.** An operator who passes no band has a limit of zero and
  the history bonus is never added. Reputation modifies a credit line; it cannot conjure one.
- **Fail closed.** An unregistered gate, a paused pool (CCP returns `12027` instead of a verdict),
  or a validator outage all resolve to "does not qualify". An outage must deny credit, never grant
  it.

The contract never learns anyone's tier — only which gates they pass, which is all
`complianceVerify` would tell it and all a credit decision needs.

## Commands

```bash
forge build            # compile
forge test             # unit suites (no network needed)
forge fmt              # format — CI enforces forge fmt --check
forge lint             # static checks
```

Fork tests against the live ERC-8004 registries on Monad (pre-deploy gate):

```bash
forge test --match-contract RegistryForkIntegration --fork-url https://testnet-rpc.monad.xyz
```

## Layout

```
src/                 — contracts
src/interfaces/      — minimal interfaces to external systems (ERC-8004 registries, the CCP
                       validator), transcribed from verified ABIs and the CCP guides
test/                — unit tests (mirrors src/), mocks under test/mocks/
script/              — deploy scripts
lib/                 — vendored dependencies (forge-std, OpenZeppelin) — committed so a
                       plain clone builds without submodule flags
```

## Network

**Monad testnet** — chain ID `10143`, RPC `https://testnet-rpc.monad.xyz` (configured as
`monad_testnet` in `foundry.toml`).

Monad rather than Arc because Cleanverse has no Arc support at all, which put the Validator
compliance pool — the entire identity gate — out of reach there. The ERC-8004 Identity and
Validation registries are deployed at the same canonical `0x8004…` addresses here, verified by
`eth_call` rather than assumed.

| Address | What |
|---|---|
| `0x8004A818BFB912233c491871b3d84c89A494BD9e` | ERC-8004 Identity Registry |
| `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | ERC-8004 Validation Registry |

## Deploying

```bash
forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
```

Two environment variables are **required and deliberately not hardcoded**, because neither has
been confirmed from a primary source yet. The deploy refuses to run without them rather than
shipping a plausible guess — a wrong validator address is the difference between an
identity-gated lender and an unsecured one, and it fails silently at demo time rather than at
compile time.

| Variable | Where to get it |
|---|---|
| `ASSET_ADDRESS` | AUSDC on Monad — `POST /query_supported_atoken_list` (needs the Cleanverse `api-id`) |
| `CCP_VALIDATOR_ADDRESS` | Cleanverse's `IAPassComplianceValidator` deployment on Monad |

After deploying there is one manual off-chain step before anything can be borrowed: register
**each `CreditTierGate`** with Cleanverse via `POST /validator/grant` then `POST
/validator/register`, carrying that band's `RuleV2.minTier`. Registration needs an EIP-191
`personal_sign` over `keccak256(chain + contract_address)` from the gate's `owner()`. Until a gate
is registered it simply never passes — so an unregistered deploy lends nothing rather than
lending unsafely.

## Known limitations

Disclosed rather than hidden — see `CLAUDE.md` §8 for the full log.

- **Single settlement asset.** `JobEscrow`, `CreditPool` and `CreditLine` all use one asset. A
  job priced in a different token would need a price oracle; inventing one would be fabricated
  data, so one asset runs end to end. Conversion seam noted in `CreditLine.ASSET`.
- **Centralized arbiter.** `JobEscrow.ARBITER` is a single immutable address, and `writeOff` is
  owner-triggered rather than permissionless-after-grace.
- **Pool shares are not an ERC-20** — non-transferable balances in `CreditPool.sharesOf`.
- **No interest accrual over time.** Lender yield is a flat facility premium in bps per
  commitment, not a borrow APR.
- **A-Pass `group`/`subGroup`/`countries` are not gated on-chain** — only the tier bands are. The
  Validator pool rule enforces the rest at `validator/verify` time, so it isn't a hole, just not
  duplicated here.
