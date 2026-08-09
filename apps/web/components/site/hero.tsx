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
    <div className="relative overflow-hidden border-y border-black/20 bg-red py-2">
      {/* Duplicated once; the track translates exactly -50% so the loop is seamless. */}
      <div className="ticker-track flex w-max items-center">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex items-center" aria-hidden={copy === 1}>
            {TICKER_ITEMS.map((item) => (
              <span key={item} className="flex items-center">
                <span className="mono-label px-6 text-black/70">{item}</span>
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
          className="pointer-events-none absolute -right-6 -top-12 select-none font-mono text-[18rem] font-bold leading-none text-black/[0.055] sm:text-[24rem]"
        >
          §
        </span>

        <div className="frame relative border-black/10">
          <nav className="flex items-center justify-between px-5 py-4 sm:px-8">
            <span className="font-mono text-base font-bold tracking-tight text-black">
              tripwire
            </span>
            <div className="flex items-center gap-5">
              <a
                href="#how"
                className="mono-label hidden text-black/70 transition-colors hover:text-black sm:block"
              >
                How it works
              </a>
              <Link
                href="/live"
                className="mono-label bg-black px-3.5 py-2 text-white btn-hard"
              >
                Try the gate
              </Link>
            </div>
          </nav>

          <div className="grid gap-10 px-5 pb-14 pt-10 sm:px-8 sm:pb-18 sm:pt-14 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
            <div data-reveal>
              <span className="mono-label text-black/55">Identity-gated agent credit</span>
              <h1 className="display mt-5 max-w-3xl text-4xl text-black sm:text-5xl lg:text-[3.5rem]">
                Agents can pay.
                <br />
                Nobody will lend.
              </h1>

              <p className="mt-6 max-w-xl text-sm leading-relaxed text-black/70 sm:text-base">
                Every agent-to-agent job today is prepaid or fully escrowed. We bind a KYC&apos;d
                identity to the operator and issue credit against it — with the lending rule living
                on Cleanverse, not in our contracts.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  href="/live"
                  className="mono-label bg-black px-5 py-3 text-white btn-hard"
                >
                  See a real credit decision
                </Link>
                <a
                  href="#how"
                  className="mono-label border border-black/40 px-5 py-3 text-black transition-colors hover:bg-black/5"
                >
                  Explore the system ↓
                </a>
              </div>
            </div>

            <SystemBrief />
          </div>
        </div>
      </div>

      <Ticker />
    </header>
  );
}

function SystemBrief() {
  const rows = [
    ["Identity", "Cleanverse A-Pass"],
    ["Decision", "3 compliance gates"],
    ["Credit", "500 — 10,000 aUSDC"],
    ["Settlement", "Monad · chain 10143"],
  ];

  return (
    <aside className="system-brief hidden border border-black/25 bg-black/[0.035] lg:block" aria-label="System brief">
      <div className="flex items-center justify-between border-b border-black/20 px-4 py-3">
        <span className="mono-label text-black/55">System brief</span>
        <span className="flex items-center gap-2 font-mono text-[0.625rem] text-black/60">
          <span className="h-1.5 w-1.5 bg-black" aria-hidden /> LIVE
        </span>
      </div>
      <dl>
        {rows.map(([label, value], index) => (
          <div
            key={label}
            className="system-brief-row grid grid-cols-[1fr_1.5fr] border-b border-black/15 px-4 py-3 last:border-b-0"
          >
            <dt className="mono-label text-black/45">0{index + 1} · {label}</dt>
            <dd className="font-mono text-[0.6875rem] text-black/75">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-4 border-t border-black/20 px-4 py-3" aria-label="Credit decision sequence">
        {[
          ["01", "A-Pass"],
          ["02", "Verify"],
          ["03", "Band"],
          ["04", "Limit"],
        ].map(([index, label]) => (
          <span key={label} className="sequence-step flex flex-col gap-1 border-l border-black/15 pl-2 first:border-l-0 first:pl-0">
            <span className="font-mono text-[0.5rem] text-black/35">{index}</span>
            <span className="mono-label text-[0.5rem] text-black/60">{label}</span>
          </span>
        ))}
      </div>
    </aside>
  );
}
