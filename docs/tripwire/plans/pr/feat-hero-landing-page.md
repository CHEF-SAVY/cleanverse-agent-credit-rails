# PR message — feat/hero-landing-page

Copy the Title into GitHub's title field (it otherwise auto-fills from the branch
name), and everything below the line into the description.

Title:

Add hero/landing page with dark theme

---

PR: feat/hero-landing-page → main

Title: Add hero/landing page with dark theme

## What

The frontend was reversed from `CLAUDE.md`'s original "skip it" plan — judges won't
`npm install` and configure `.env` files locally, and passive viewing isn't proof the
product works. This is the first page of that build: a real, public landing page,
designed off a Dribbble reference (`Aivora`), adapted to Tripwire's own mechanism and
voice.

- **New `app/globals.css` palette** — dark, near-monochrome (background `~#0a0a0b`,
  near-white foreground), blue `--primary` for the calm/normal flow, red `--destructive`
  deliberately reserved for the dispute/slash branch. Every existing component already
  reads color through this CSS variable indirection (`bg-background`,
  `text-muted-foreground`, etc. via `@theme inline`), so this cascades to every existing
  component automatically — no per-component rework.
- **New `components/landing/`**: `grid-glow-background` (pure CSS grid + radial glow),
  `hero-nav`, `hero-section` (badge, two-line headline, subtext, two CTAs), and
  `mechanism-diagram` — a real diagram of Tripwire's actual flow (Buyer → `JobEscrow` →
  Seller, branching to Release or Dispute → Resolve → Bond Slashed), not decorative
  filler.
- **`app/page.tsx`** now renders the hero instead of a sign-in form.
- **Removed `app/actions.ts`'s `login()`** and its hardcoded credentials
  (`admin@example.com` / `123456`).

## Why

- **The mechanism diagram is honest, not decorative.** The reference's own diagram
  visualizes a generic AI-agent tool workflow; Tripwire's version visualizes the real
  on-chain state machine. Color is functional: release stays the same calm blue as the
  rest of the page, red is reserved for the one place the product's own name — a
  tripwire — actually trips.
- **The login gate never protected anything real.** No `middleware.ts` exists anywhere in
  the project, so `/dashboard` was always directly reachable by URL regardless of the
  login screen. The credentials were hardcoded in source, in a repo that's about to go
  public. The one actually-sensitive action behind it (withdraw) already has its own real
  protection (`WITHDRAW_API_KEY`, from the pre-deploy audit) — the login screen had
  nothing left to protect and just added friction for anyone landing on `/`.
- **Font stays Geist** (already imported) and the grid/glow background is pure CSS — zero
  new dependencies for this page.

## Testing

- `npx tsc --noEmit` / `npm run lint` clean.
- **Verified live in-browser**, not just typechecked — headless Chrome screenshots at
  both desktop (1440px) and mobile (390px) widths. Caught and fixed a real issue this
  way: the top Buyer/JobEscrow/Seller row was too cramped at phone width (three
  fixed-width cards in one row); now stacks vertically below the `sm` breakpoint, same
  pattern the branch cards already used.
- Confirmed existing shadcn/Radix components (badge, buttons) render correctly against
  the new dark palette without any component-level changes.
