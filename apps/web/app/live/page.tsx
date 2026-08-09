/**
 * The live console page.
 *
 * Separated from the story page so that a slow or unavailable Cleanverse can never make the pitch
 * itself look broken — the landing page is static, this one is honest about being live.
 */

import Link from "next/link";

import { LiveConsole } from "@/components/site/live-console";
import { Eyebrow, Frame } from "@/components/site/primitives";
import { SiteFooter } from "@/components/site/sections";
import { evaluateEligibility } from "@/lib/cleanverse";

export const metadata = {
  title: "Live console — Ledgerline",
  description:
    "A real credit decision, made by Cleanverse's on-chain compliance validator against real A-Passes on Monad testnet.",
};

/** Nigerian passport at classification 40 — the wallet the rule-change demo acts on. */
const DEFAULT_ADDRESS = "0x00000000000000000000000000000000000d0001";

async function loadInitial() {
  try {
    const report = await evaluateEligibility(DEFAULT_ADDRESS);
    return { report: JSON.parse(JSON.stringify(report)), error: null };
  } catch (error) {
    // The page still renders; the console shows its "check unavailable" state.
    return {
      report: null,
      error: error instanceof Error ? error.message : "Could not reach the compliance validator.",
    };
  }
}

export default async function LivePage() {
  const initial = await loadInitial();

  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-white/[0.09]">
        <Frame>
          <nav className="flex items-center justify-between px-6 py-6 sm:px-10">
            <Link href="/" className="font-mono text-lg font-bold tracking-tight text-white">
              ledgerline
            </Link>
            <Link
              href="/"
              className="mono-label text-white/50 transition-colors hover:text-white"
            >
              ← Back to overview
            </Link>
          </nav>
        </Frame>
      </div>

      <Frame>
        <div className="px-6 pb-4 pt-16 sm:px-10">
          <Eyebrow icon="▶">Live · Monad testnet</Eyebrow>
          <h1 className="display mt-7 max-w-3xl text-4xl text-white sm:text-5xl md:text-6xl">
            A real credit decision.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/55">
            Pick an operator. We read their A-Pass from Cleanverse, then ask the on-chain
            compliance validator whether they clear each band. The verdict is theirs — we only
            explain it.
          </p>
        </div>

        <LiveConsole
          initialAddress={DEFAULT_ADDRESS}
          initialReport={initial.report}
          initialError={initial.error}
        />
      </Frame>

      <div className="border-t border-white/[0.09]">
        <SiteFooter />
      </div>
    </main>
  );
}
