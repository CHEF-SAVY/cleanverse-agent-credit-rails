/**
 * The live console page.
 *
 * Separated from the story page so that a slow or unavailable Cleanverse can never make the pitch
 * itself look broken — the landing page is static, this one is honest about being live.
 */

import Link from "next/link";
import { connection } from "next/server";

import { inspectDemoPolicy } from "@/app/live/actions";
import { LiveConsole } from "@/components/site/live-console";
import { Eyebrow, Frame } from "@/components/site/primitives";
import { SiteFooter } from "@/components/site/sections";
import { evaluateEligibility } from "@/lib/cleanverse";

export const metadata = {
  title: "Live console — Tripwire",
  description:
    "A real credit decision, made by Cleanverse's on-chain compliance validator against real A-Passes on Monad testnet.",
};

// The first paint intentionally waits for a real, uncached compliance verdict. This route cannot
// ship a truthful static shell, so allow it to block instead of replacing that verdict with a
// loading placeholder during partial prerendering.
export const instant = false;

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
  // Cleanverse requests carry a fresh request id and verdicts must never be cached. Tell Next's
  // Cache Components renderer that everything below belongs to this request, not the static shell.
  await connection();
  const [initial, initialPolicy] = await Promise.all([loadInitial(), inspectDemoPolicy()]);

  return (
    <main className="ambient-page min-h-screen">
      <div className="border-b border-white/[0.09]">
        <Frame>
          <nav className="flex items-center justify-between px-5 py-4 sm:px-8">
            <Link href="/" className="font-mono text-base font-bold tracking-tight text-white">
              tripwire
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
        <div className="px-5 pb-4 pt-10 sm:px-8 sm:pt-12">
          <Eyebrow icon="▶">Live · Monad testnet</Eyebrow>
          <h1 className="display mt-5 max-w-3xl text-3xl text-white sm:text-4xl md:text-[2.75rem]">
            A real credit decision.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/55 sm:text-base">
            Pick an operator. We read their A-Pass from Cleanverse, then ask the on-chain
            compliance validator whether they clear each band. The verdict is theirs — we only
            explain it.
          </p>
        </div>

        <LiveConsole
          initialAddress={DEFAULT_ADDRESS}
          initialReport={initial.report}
          initialError={initial.error}
          initialPolicy={initialPolicy}
        />
      </Frame>

      <div className="border-t border-white/[0.09]">
        <SiteFooter />
      </div>
    </main>
  );
}
