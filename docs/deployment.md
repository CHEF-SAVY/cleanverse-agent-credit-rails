# Deployment

## There is no separate backend

Worth stating plainly, because "deploy the backend" implies a second service that does not exist.
Every Cleanverse HTTP call lives in **Next.js route handlers and server actions inside
`apps/web`**. Deploying that one app deploys the API and the UI together.

That is deliberate, not a shortcut. The Cleanverse `api-key` is an AES key rather than a bearer
token, so it must never leave the server — and with one service there is no internal network hop
where it could leak. `getCleanverseConfig()` throws if it is ever evaluated in a browser bundle.

The contracts are already deployed to Monad testnet and are not part of this.

---

## Render (free tier)

`render.yaml` at the repo root is a complete blueprint. Two ways to use it:

**Blueprint (recommended)** — Render reads the file and provisions everything:

1. Push the branch to GitHub.
2. Render dashboard → **New → Blueprint** → pick the repo.
3. Render will prompt for every secret marked `sync: false`. Fill them in (§Secrets below).
4. Deploy. First build takes ~3–5 minutes.

**Manual** — New → Web Service, runtime **Node**, then:

- Build: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter web build`
- Start: `pnpm --filter web start`
- Health check path: `/api/cleanverse/health`
- Add every env var from `render.yaml` by hand.

### Secrets to paste in

Copy these from `contracts/.env` / `apps/web/.env.local` — both are gitignored and must stay that
way:

| Variable | What it is |
|---|---|
| `CLEANVERSE_API_ID` | Your Cleanverse api-id |
| `CLEANVERSE_API_KEY` | **The AES key.** Never `NEXT_PUBLIC_`, never logged |
| `CLEANVERSE_ADMIN_KEY` | Guards the policy-write endpoints. Unset ⇒ they refuse everything |
| `POOL_OWNER_PRIVATE_KEY` | Owner of the gate contracts; signs rule writes. **A real private key** |
| `MONAD_RPC_URL` | Optional but recommended — the public RPC rate-limits under demo load |

The non-secret values (gate addresses, `ASSET_ADDRESS`, chain) are already pinned in
`render.yaml` because each has been verified on-chain.

### Verify the deploy

```bash
curl -s https://<your-service>.onrender.com/api/cleanverse/health | python3 -m json.tool
```

All four checks must read `ok`: `credentials`, `encryption`, `api`, `settlement-asset`. The health
route is also the Render health check, so a bad credential shows up as a failed deploy rather than
a broken page.

Then load `/live` and confirm a real verdict renders.

---

## ⚠️ Free tier caveats that matter for a demo

**Cold starts.** Render's free tier spins a service down after ~15 minutes of inactivity, and the
next request takes **roughly 50 seconds** to wake it. `/live` also does real Cleanverse round-trips
on first render, so a cold visit can feel broken.

Mitigations, in order of effort:

1. **Hit the URL a few minutes before demoing.** Simplest and sufficient.
2. Point an uptime pinger at `/api/cleanverse/health` every 10 minutes.
3. Upgrade to the paid instance if the demo is unattended.

**Single instance.** `lib/cleanverse/rules.ts` serialises rule writes with an in-process queue,
which is only correct on one instance. Render's free tier runs exactly one, so this holds — but if
it is ever scaled out, that queue needs to become a shared lock (a DB row or Redis). The code says
so at the definition.

**Region latency.** Cleanverse's sandbox and Monad's RPC are both reachable from Render's US
regions; `oregon` was chosen arbitrarily. If rule writes feel slow, try `frankfurt` or `singapore`.

---

## Vercel, if Render disappoints

This is a stock Next.js 16 app, so Vercel needs no config beyond the same environment variables —
set the root directory to `apps/web`. Vercel has no cold-start penalty of this shape, which for a
judged demo is a real advantage. Render was chosen here because it was asked for; the app is not
coupled to either.

One caveat either way: **serverless platforms may run several instances**, which breaks the
single-instance assumption above. On Vercel, rule writes should be treated as best-effort-serial
until a shared lock exists.

---

## What is *not* deployed by this

- **The contracts.** Already live on Monad testnet — see `SUBMISSION.md` for addresses.
- **`CreditPool` / `CreditLine` / `JobEscrow`.** Not yet deployed at all; `Deploy.s.sol` is
  unblocked but has not been run. The site does not depend on them, so this deploy works today.
- **A database.** There isn't one. Every read is live from Cleanverse or the chain, which is also
  why nothing here caches a compliance verdict.
