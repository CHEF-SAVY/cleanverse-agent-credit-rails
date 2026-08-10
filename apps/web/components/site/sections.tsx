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
          align="left"
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
            <Cell key={p.tag} className={`sm:border-l reveal-delay-${i}`}>
              <span className="mono-label text-red">{p.tag}</span>
              <h3 className="mt-3 text-lg text-white sm:text-xl">{p.title}</h3>
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-white/50">{p.body}</p>
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
          align="left"
          lede={
            <>
              Our contract never decides who qualifies. It asks Cleanverse&apos;s compliance
              validator inside the borrowing transaction and obeys the answer — so tightening
              lending standards is a rule change on their side, not a redeploy on ours.
            </>
          }
        />

        <div className="px-5 pb-14 sm:px-8">
          {/* Compact horizontal system map on desktop — the whole authority chain in one scan. */}
          <div className="hidden grid-cols-[1fr_auto_0.8fr_auto_1.05fr_auto_0.9fr_auto_0.85fr] items-stretch lg:grid">
            <div className="grid gap-2">
              <Node label="Operator" sub="verified entity" className="flow-node flow-node-1 w-full" />
              <Node label="A-Pass" sub="tier · country" tone="red" className="flow-node flow-node-2 w-full" />
            </div>
            <FlowLink label="binds" />
            <Node label="Agent #8004" sub="registry identity" className="flow-node flow-node-3 w-full" />
            <FlowLink label="queries" />
            <div className="grid gap-2">
              {CREDIT_BANDS.map((band) => (
                <Node
                  key={band.label}
                  label={band.label}
                  sub={`class ≥ ${band.rule.min_sub_tier}`}
                  className="flow-node flow-node-4 w-full"
                />
              ))}
            </div>
            <FlowLink label="verifies" emphasis />
            <Node label="CCP Validator" sub="Cleanverse · on-chain" tone="red" className="flow-node flow-node-5 w-full" />
            <FlowLink label="returns limit" />
            <Node label="Credit line" sub="aUSDC · no collateral" tone="live" className="flow-node flow-node-6 w-full" />
          </div>

          {/* The same authority chain stays vertical and legible on narrow screens. */}
          <div className="mx-auto max-w-2xl lg:hidden">
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

          <div className="mt-8 grid grid-cols-2 border border-white/[0.09] md:grid-cols-4">
            <ArchitectureFact label="Identity source" value="A-Pass" />
            <ArchitectureFact label="Decision authority" value="CCP validator" />
            <ArchitectureFact label="Settlement" value="aUSDC" />
            <ArchitectureFact label="Personal data held" value="None" />
          </div>

          <p className="mx-auto mt-8 max-w-2xl border-l-2 border-red/50 pl-4 text-[0.8125rem] leading-relaxed text-white/50">
            <span className="text-white/80">We never learn anyone&apos;s tier.</span> The validator
            answers yes or no per band, which is all a credit decision needs — so the protocol holds
            no personal data it doesn&apos;t require.
          </p>
        </div>
      </Frame>
    </section>
  );
}

function FlowLink({ label, emphasis }: { label: string; emphasis?: boolean }) {
  return (
    <div className="flex min-w-14 flex-col items-center justify-center px-2" aria-hidden>
      <span className={`mono-label text-[0.5rem] ${emphasis ? "text-red" : "text-white/25"}`}>
        {label}
      </span>
      <div className="mt-2 flex w-full items-center">
        <span className={`flow-wire h-px flex-1 ${emphasis ? "bg-red/60" : "bg-white/15"}`} />
        <span className={emphasis ? "text-red/70" : "text-white/25"}>›</span>
      </div>
    </div>
  );
}

function ArchitectureFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-t border-white/[0.09] p-4 first:border-l-0 md:border-t-0">
      <span className="mono-label text-white/25">{label}</span>
      <p className="mt-2 font-mono text-xs text-white/65">{value}</p>
    </div>
  );
}

function Connector({ label, emphasis }: { label: string; emphasis?: boolean }) {
  return (
    <div className="flex flex-col items-center py-1" aria-hidden>
      <span className={emphasis ? "h-4 w-px bg-red/60" : "h-4 w-px bg-white/15"} />
      <span
        className={`mono-label py-1 text-[0.5rem] ${emphasis ? "text-red" : "text-white/30"}`}
      >
        {label}
      </span>
      <span className={emphasis ? "h-4 w-px bg-red/60" : "h-4 w-px bg-white/15"} />
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
          align="left"
          lede="Each band is a contract registered with Cleanverse against its own compliance rule. Your limit is the highest band you pass."
        />
        <div className="grid grid-cols-1 border-b border-white/[0.09] md:grid-cols-3">
          {CREDIT_BANDS.map((band, index) => (
            <Cell key={band.label} className={`md:border-l reveal-delay-${index}`}>
              <div className="flex items-baseline justify-between">
                <span className="mono-label text-red">{band.label}</span>
                <span className="mono-label text-white/30">
                  ≥ {band.rule.min_sub_tier}
                </span>
              </div>
              <p className="display mt-5 text-3xl text-white sm:text-4xl">
                {(Number(band.limit) / 1e6).toLocaleString()}
              </p>
              <p className="mono-label mt-2 text-white/40">aUSDC</p>
              <p className="mt-4 text-[0.8125rem] text-white/50">{band.description}</p>
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
      <Frame className="bg-[#e9e8e3]">
        <div className="grid grid-cols-2 md:grid-cols-4">
          {STATS.map((s, index) => (
            <div key={s.label} data-reveal className={`border-l border-t border-black/15 p-5 first:border-l-0 sm:p-6 reveal-delay-${index}`}>
              <span className="mono-label text-red">{s.label}</span>
              <p className="display mt-3 text-3xl text-black sm:text-4xl">{s.value}</p>
              <p className="mono-label mt-2 text-[0.5rem] leading-relaxed text-black/50">
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
        <div className="px-5 py-16 text-center sm:px-8 md:py-20" data-reveal>
          <Eyebrow icon="▶">Live on Monad testnet</Eyebrow>
          <h2 className="display mx-auto mt-5 max-w-3xl text-3xl text-white sm:text-4xl md:text-[2.75rem]">
            Watch a compliance rule
            <br />
            change someone&apos;s credit.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm text-white/50">
            Real wallets, real A-Passes, real rules on Cleanverse. Nothing on the next page is
            mocked.
          </p>
          <Link
            href="/live"
            className="mono-label mt-7 inline-block bg-red px-6 py-3 text-black btn-hard"
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
        <div className="grid grid-cols-1 gap-8 px-5 py-10 sm:grid-cols-3 sm:px-8">
          <div>
            <span className="font-mono text-base font-bold tracking-tight text-white">
              tripwire
            </span>
            <p className="mt-3 max-w-xs text-xs leading-relaxed text-white/40">
              Identity-gated credit for AI agents. Built on Cleanverse A-Pass, ERC-8004 and x402.
            </p>
          </div>
          <div>
            <span className="mono-label text-white/40">Built on</span>
            <ul className="mt-3 space-y-1.5 text-xs text-white/60">
              <li>Cleanverse Compliance Protocol</li>
              <li>ERC-8004 agent registries</li>
              <li>Monad testnet · chain 10143</li>
            </ul>
          </div>
          <div>
            <span className="mono-label text-white/40">Settlement</span>
            <ul className="mt-3 space-y-1.5 text-xs text-white/60">
              <li>aUSDC — compliance-gated A-Token</li>
              <li>Recipient-gated transfers</li>
              <li>Travel Rule export</li>
            </ul>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-white/[0.09] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
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
