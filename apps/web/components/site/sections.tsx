/**
 * The narrative sections of the landing page: the problem, the architecture, the credit ladder,
 * and the numbers.
 *
 * All server components — none of this needs interactivity, and keeping it static means the story
 * renders instantly even if Cleanverse is slow. The live data lives on `/live`, deliberately
 * separated so a network hiccup can never make the pitch itself look broken.
 */

import Link from "next/link";

import { CREDIT_BANDS } from "@/lib/cleanverse/bands";

import { Cell, Eyebrow, Frame, Node, SectionHeading } from "./primitives";

const PROBLEMS = [
  {
    tag: "CAPITAL LOCKED",
    title: "Every job is prepaid.",
    body: "An agent must hold the full value of a job before it can buy anything. Working capital sits idle instead of working.",
  },
  {
    tag: "IDENTITY OUT OF SCOPE",
    title: "x402 doesn't know who you are.",
    body: "The payment rail is deliberately identity-free. It moves money beautifully and can tell you nothing about who is on the other side.",
  },
  {
    tag: "REPUTATION ISN'T CREDIT",
    title: "ERC-8004 says who, not whether.",
    body: "Agent registries prove an agent exists and who operates it. That is not the same as a reason to lend anyone money.",
  },
  {
    tag: "NO RECOURSE",
    title: "A pseudonym can't default.",
    body: "Without a real identity behind the wallet there is nothing to underwrite, nothing to report, and nobody to pursue.",
  },
];

export function Problem() {
  return (
    <section className="border-b border-white/[0.09]">
      <Frame>
        <SectionHeading
          eyebrow="The problem"
          icon="×"
          title={
            <>
              Agents move billions.
              <br />
              None of it on credit.
            </>
          }
        />
        <div className="grid grid-cols-1 border-b border-white/[0.09] sm:grid-cols-2">
          {PROBLEMS.map((p, i) => (
            <Cell key={p.tag} className={i % 2 === 1 ? "sm:border-l" : "sm:border-l"}>
              <span className="mono-label text-red">{p.tag}</span>
              <h3 className="mt-4 text-xl text-white sm:text-2xl">{p.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/50">{p.body}</p>
            </Cell>
          ))}
        </div>
      </Frame>
    </section>
  );
}

/**
 * The architecture diagram.
 *
 * Built from bordered nodes and hairline connectors rather than an image, so it stays crisp at
 * any size and the labels are real text. The one idea it has to land: the credit decision is
 * made by Cleanverse, and our contract only asks.
 */
export function Architecture() {
  return (
    <section id="how" className="border-b border-white/[0.09]">
      <Frame>
        <SectionHeading
          eyebrow="How it works"
          icon="⛓"
          title="The rule isn't ours."
          lede={
            <>
              Our contract never decides who qualifies. It asks Cleanverse&apos;s compliance
              validator inside the borrowing transaction and obeys the answer — so tightening
              lending standards is a rule change on their side, not a redeploy on ours.
            </>
          }
        />

        <div className="px-6 pb-20 sm:px-10">
          <div className="mx-auto max-w-3xl">
            {/* Row 1 — identity in */}
            <div className="flex flex-col items-center gap-3">
              <Node label="Operator" sub="KYC'd human / company" />
              <Connector label="issues" />
              <Node label="A-Pass" sub="tier · subtier · countries" tone="red" />
            </div>

            <Connector label="bound to wallet" />

            {/* Row 2 — the agent */}
            <div className="flex flex-col items-center gap-3">
              <Node label="Agent #8004" sub="erc-8004 identity registry" />
            </div>

            <Connector label="creditLimit(agentId)" />

            {/* Row 3 — the three gates */}
            <div className="grid grid-cols-3 gap-3">
              {CREDIT_BANDS.map((band) => (
                <Node
                  key={band.label}
                  label={band.label}
                  sub={`min subtier ${band.rule.min_sub_tier}`}
                />
              ))}
            </div>

            <Connector label="complianceVerify(gate, operator)" emphasis />

            <div className="flex flex-col items-center gap-3">
              <Node label="CCP Validator" sub="cleanverse · on-chain · permissionless" tone="red" />
            </div>

            <Connector label="highest passing band wins" />

            <div className="flex flex-col items-center gap-3">
              <Node label="Credit line" sub="drawn in aUSDC · no collateral" tone="live" />
            </div>
          </div>

          <p className="mx-auto mt-14 max-w-2xl border-l-2 border-red/50 pl-5 text-sm leading-relaxed text-white/50">
            <span className="text-white/80">We never learn anyone&apos;s tier.</span> The validator
            answers yes or no per band, which is all a credit decision needs — so the protocol holds
            no personal data it doesn&apos;t require.
          </p>
        </div>
      </Frame>
    </section>
  );
}

function Connector({ label, emphasis }: { label: string; emphasis?: boolean }) {
  return (
    <div className="flex flex-col items-center py-2" aria-hidden>
      <span className={emphasis ? "h-6 w-px bg-red/60" : "h-6 w-px bg-white/15"} />
      <span
        className={`mono-label py-1 text-[0.5625rem] ${emphasis ? "text-red" : "text-white/30"}`}
      >
        {label}
      </span>
      <span className={emphasis ? "h-6 w-px bg-red/60" : "h-6 w-px bg-white/15"} />
    </div>
  );
}

export function Ladder() {
  return (
    <section className="border-b border-white/[0.09]">
      <Frame>
        <SectionHeading
          eyebrow="The ladder"
          icon="▤"
          title="Three bands. One question each."
          lede="Each band is a contract registered with Cleanverse against its own compliance rule. Your limit is the highest band you pass."
        />
        <div className="grid grid-cols-1 border-b border-white/[0.09] md:grid-cols-3">
          {CREDIT_BANDS.map((band) => (
            <Cell key={band.label} className="md:border-l">
              <div className="flex items-baseline justify-between">
                <span className="mono-label text-red">{band.label}</span>
                <span className="mono-label text-white/30">
                  ≥ {band.rule.min_sub_tier}
                </span>
              </div>
              <p className="display mt-6 text-4xl text-white sm:text-5xl">
                {(Number(band.limit) / 1e6).toLocaleString()}
              </p>
              <p className="mono-label mt-2 text-white/40">aUSDC</p>
              <p className="mt-5 text-sm text-white/50">{band.description}</p>
            </Cell>
          ))}
        </div>
      </Frame>
    </section>
  );
}

const STATS = [
  { label: "COLLATERAL", value: "0%", note: "Identity replaces the deposit" },
  { label: "CONTRACT TESTS", value: "150", note: "Plus a fork suite on Monad" },
  { label: "SETTLEMENT", value: "aUSDC", note: "A real compliance-gated A-Token" },
  { label: "RULE CHANGES", value: "Live", note: "No redeploy, no migration" },
];

export function Stats() {
  return (
    <section className="border-b border-white/[0.09]">
      <Frame>
        <div className="grid grid-cols-2 md:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="border-l border-t border-white/[0.09] p-7 sm:p-9">
              <span className="mono-label text-red">{s.label}</span>
              <p className="display mt-4 text-4xl text-white sm:text-5xl">{s.value}</p>
              <p className="mono-label mt-3 text-[0.5625rem] leading-relaxed text-white/35">
                {s.note}
              </p>
            </div>
          ))}
        </div>
      </Frame>
    </section>
  );
}

export function CallToAction() {
  return (
    <section className="border-b border-white/[0.09]">
      <Frame>
        <div className="px-6 py-24 text-center sm:px-10 md:py-32">
          <Eyebrow icon="▶">Live on Monad testnet</Eyebrow>
          <h2 className="display mx-auto mt-7 max-w-3xl text-4xl text-white sm:text-5xl md:text-6xl">
            Watch a compliance rule
            <br />
            change someone&apos;s credit.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-white/50">
            Real wallets, real A-Passes, real rules on Cleanverse. Nothing on the next page is
            mocked.
          </p>
          <Link
            href="/live"
            className="mono-label mt-10 inline-block bg-red px-8 py-4 text-black btn-hard"
          >
            Open the console →
          </Link>
        </div>
      </Frame>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <Frame>
        <div className="grid grid-cols-1 gap-10 px-6 py-16 sm:grid-cols-3 sm:px-10">
          <div>
            <span className="font-mono text-lg font-bold tracking-tight text-white">
              ledgerline
            </span>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/40">
              Identity-gated credit for AI agents. Built on Cleanverse A-Pass, ERC-8004 and x402.
            </p>
          </div>
          <div>
            <span className="mono-label text-white/40">Built on</span>
            <ul className="mt-4 space-y-2 text-sm text-white/60">
              <li>Cleanverse Compliance Protocol</li>
              <li>ERC-8004 agent registries</li>
              <li>Monad testnet · chain 10143</li>
            </ul>
          </div>
          <div>
            <span className="mono-label text-white/40">Settlement</span>
            <ul className="mt-4 space-y-2 text-sm text-white/60">
              <li>aUSDC — compliance-gated A-Token</li>
              <li>Recipient-gated transfers</li>
              <li>Travel Rule export</li>
            </ul>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-white/[0.09] px-6 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <span className="mono-label text-white/30">
            Hackathon build · DeFi &amp; Verified Finance
          </span>
          <span className="mono-label flex items-center gap-2 text-white/30">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            All systems live
          </span>
        </div>
      </Frame>
    </footer>
  );
}
