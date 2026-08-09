# Demo script — 3 minutes

The whole demo rests on one idea: **we do not decide who gets credit. Cleanverse does, and we
obey it live.** Everything below exists to make that undeniable rather than claimed.

---

## Before you start (2 minutes, do it every time)

```bash
cd apps/web && ./node_modules/.bin/next dev
```

1. **Health check must be all-green** — `curl -s localhost:3000/api/cleanverse/health | python3 -m json.tool`.
   Four `ok`s: credentials, encryption, api, settlement-asset. If any fails, stop and fix; the
   demo reads live and will show the failure rather than fake it.
2. **Reset band-2 to its default** so the rule change has somewhere to go:
   open `/live`, and if the button reads *"Reset band-2 rule"*, click it once and wait for it to
   settle back to *"Restrict to GB only"*.
3. **Load `/live` once** to warm it. First render does real Cleanverse round-trips.
4. If deployed on Render's free tier, **hit the URL 5 minutes early** — cold start is ~50 seconds.

---

## The script

### [0:00] The problem — on `/`

> "AI agents can pay each other. x402 has done over 100 million transactions. But no one will
> lend to them — every job is prepaid or fully escrowed, so an agent has to hold the whole value
> of a job before it can buy anything.
>
> The reason is simple: x402 puts identity out of scope, and ERC-8004 tells you *who* an agent is,
> not whether anyone should lend to it. There's nothing to underwrite."

*Scroll to the architecture diagram.*

> "So we bind a KYC'd A-Pass to the agent's operator, and size their credit line from it."

### [0:40] The mechanism — still on `/`

Point at the diagram, and land this one line:

> "The rule that decides who qualifies doesn't live in our contract. It lives in Cleanverse's
> compliance validator. Our contract asks it — inside the borrowing transaction — and obeys.
>
> We never even learn anyone's tier. We ask three yes/no questions, one per credit band, and grant
> the highest band that passes. That's all a credit decision needs."

*Click through to `/live`.*

### [1:10] A real decision — on `/live`

> "This is not a mockup. Every number here is a live call."

*Click **Verified** (classification 10).* → **500 aUSDC**, band-1 only.

*Click **Institutional** (classification 80).* → **10,000 aUSDC**, all three bands pass.

> "Same code, different identity, different limit. And when a band is denied it says why —"

*Point at band-3's card on the Verified operator: `SUBTIER_TOO_LOW`, the bar showing 10 / 80.*

> "— which band, and how far short. Being ineligible isn't an error, it's an explanation."

### [1:50] 🎯 The moment — the rule change

*Select **Enhanced · NG** (classification 40, Nigerian passport).* → **2,500 aUSDC**, band-2.

> "This operator holds a Nigerian passport. Cleanverse derived that from their actual identity
> documents — it's the one attribute nobody can self-declare.
>
> Now suppose compliance decides this band is GB-only."

*Click **Restrict to GB only**. It writes to Cleanverse and confirms on-chain — 5 to 15 seconds.
Narrate while it runs:*

> "That's a transaction against Cleanverse's validator. We are not deploying anything. We are not
> touching our contracts. We're changing *their* rule."

*The page re-reads and the operator drops to **500 aUSDC**, band-2 now `COUNTRY_NOT_PERMITTED`.*

> "Two and a half thousand down to five hundred. No redeploy, no migration, no code change. Their
> passport no longer matches the rule, so their credit changed.
>
> That's what identity-gated lending actually means."

*Click **Reset band-2 rule** to restore — it's reversible, which also proves it's real.*

### [2:40] Close

> "150 contract tests, a full audit, a real A-Token for settlement, and every address verified
> on-chain before we hardcoded it. Deployed on Monad because Cleanverse doesn't support Arc — and
> aUSDC is at the same address on Base, so that's a cheap next step, not a rewrite."

---

## Questions you should expect

**"Isn't the tier just something you set?"**
Be straight about this. `subTier` is a classification *we* submit, so bands keyed on it are partly
our own judgement — and every sandbox A-Pass comes back at tier 50 regardless of the documents
submitted, which we measured across seven passes. **`countries` is different**: Cleanverse derives
it from the identity documents and we cannot set it. That's exactly why the live demo gates on
country rather than tier. In production with varied real tiers, the same mechanism uses `minTier`
and the asymmetry disappears.

**"What happens if Cleanverse goes down?"**
Credit is denied. Fail-closed on both sides — the contract swallows validator reverts into
"denied", and the UI shows `VALIDATOR_UNAVAILABLE`, which is a distinct state from a real denial so
it reads as "couldn't check", not "you don't qualify". An outage must never grant credit.

**"Can an agent just default and re-borrow?"**
No. Write-offs move principal to `chargedOff`, which blocks all new borrowing until cleared, and
paying it off is booked as a recovery, not a repayment. Job history is *not* restored — paying off
a default buys back the right to borrow, not the reputation forfeited with it.

**"Is the pool a real token?"**
Yes — aUSDC, a compliance-gated A-Token, at `0xaC08…f20D`, verified on-chain. Which surfaced
something worth mentioning: **A-Token transfers are recipient-gated, and contracts aren't exempt**.
`CreditPool` needs its own A-Pass or deposits revert. We proved that by issuing a pass to a
contract address and re-running the transfer check.

**"What's not finished?"**
The borrow → job → repay flow hasn't run end to end yet; `CreditPool`/`CreditLine`/`JobEscrow`
aren't deployed. Say so plainly. Everything shown in the demo is genuinely live.

---

## If something breaks mid-demo

- **Rule change appears to fail** — check the copy. If it says the rule was confirmed by read-back,
  it worked; the response was just lost in transit. Refresh and the state will be correct.
- **A band shows amber "couldn't check"** — that's a Cleanverse timeout, not a denial. Click retry.
- **Everything is slow on first load** — cold start. This is why you warm it first.
- **Worst case**: the landing page at `/` is entirely static and never touches the network. The
  story survives without the console.
