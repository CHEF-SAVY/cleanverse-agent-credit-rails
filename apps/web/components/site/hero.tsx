/**
 * Hero + ticker.
 *
 * The red panel is the page's one loud moment; everything after it is near-black. That contrast
 * is the whole reason the reference design works, so the hero stays flat and confident rather
 * than gradient-heavy.
 */

import Link from "next/link";

const TICKER_ITEMS = [
  "A-PASS GATED",
  "NO COLLATERAL",
  "ERC-8004 AGENTS",
  "COMPLIANCE POOLS ON-CHAIN",
  "REAL aUSDC",
  "MONAD TESTNET",
  "RULES LIVE ON CLEANVERSE",
  "x402 SETTLEMENT",
];

function Ticker() {
  return (
    <div className="relative overflow-hidden border-y border-black/20 bg-red py-3">
      {/* Duplicated once; the track translates exactly -50% so the loop is seamless. */}
      <div className="ticker-track flex w-max items-center">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex items-center" aria-hidden={copy === 1}>
            {TICKER_ITEMS.map((item) => (
              <span key={item} className="flex items-center">
                <span className="mono-label px-8 text-black/70">{item}</span>
                <span className="text-black/30" aria-hidden>
                  ◆
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <header>
      <div className="hero-red relative overflow-hidden">
        {/* Oversized wordmark watermark, echoing the reference's ghost logo. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-16 select-none font-mono text-[22rem] font-bold leading-none text-black/[0.06] sm:text-[30rem]"
        >
          §
        </span>

        <div className="frame relative border-black/10">
          <nav className="flex items-center justify-between px-6 py-6 sm:px-10">
            <span className="font-mono text-lg font-bold tracking-tight text-black">
              ledgerline
            </span>
            <div className="flex items-center gap-6">
              <a
                href="#how"
                className="mono-label hidden text-black/70 transition-colors hover:text-black sm:block"
              >
                How it works
              </a>
              <Link
                href="/live"
                className="mono-label bg-black px-4 py-2.5 text-white btn-hard"
              >
                Try the gate
              </Link>
            </div>
          </nav>

          <div className="px-6 pb-20 pt-10 sm:px-10 sm:pb-28 sm:pt-16">
            <h1 className="display max-w-4xl text-5xl text-black sm:text-6xl md:text-7xl lg:text-[5.25rem]">
              Agents can pay.
              <br />
              Nobody will lend.
            </h1>

            <p className="mt-8 max-w-xl text-base leading-relaxed text-black/70 sm:text-lg">
              Every agent-to-agent job today is prepaid or fully escrowed. We bind a KYC&apos;d
              identity to the operator and issue credit against it — with the lending rule living
              on Cleanverse, not in our contracts.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                href="/live"
                className="mono-label bg-black px-6 py-4 text-white btn-hard"
              >
                See a real credit decision
              </Link>
              <a
                href="#how"
                className="mono-label border border-black/40 px-6 py-4 text-black transition-colors hover:bg-black/5"
              >
                How it works ↓
              </a>
            </div>
          </div>
        </div>
      </div>

      <Ticker />
    </header>
  );
}
