"use client";

/**
 * The live console.
 *
 * Every number on this screen comes from a real call: `query_apass` for the identity,
 * `validator/verify` against each registered gate for the verdict, and `validator/set_rule` for
 * the policy change. Nothing here is mocked, which is the entire point of the page.
 *
 * Interaction states are treated as first-class, and **"not eligible" is a success state** — an
 * operator who misses a band gets the reason and the gap, never a red error.
 */

import { useCallback, useRef, useState, useTransition } from "react";

import {
  changeDemoPolicy,
  inspectDemoPolicy,
  type DemoPolicySnapshot,
} from "@/app/live/actions";

interface BandVerdict {
  label: string;
  description: string;
  limit: string;
  passed: boolean;
  code: string;
  message: string;
  shortfall?: { field: string; required: number; actual: number; gap: number };
  requirement: { minTier: number; minSubTier: number };
}

interface Report {
  address: string;
  onboarded: boolean;
  apass: {
    tier: number;
    subTier: number;
    countries: string[];
    expiresAt: string;
    usable: boolean;
  } | null;
  qualified: boolean;
  band: { label: string; limit: string; description: string } | null;
  bands: BandVerdict[];
  summary: { code: string; message: string };
}

/** Real wallets onboarded on the Cleanverse sandbox, each chosen to show a different outcome. */
const PRESETS = [
  {
    name: "No A-Pass",
    hint: "never verified",
    address: "0x9999999999999999999999999999999999999999",
  },
  {
    name: "Verified",
    hint: "classification 10",
    address: "0x00000000000000000000000000000000000a0002",
  },
  {
    name: "Enhanced · NG",
    hint: "classification 40 · Nigerian passport",
    address: "0x00000000000000000000000000000000000d0001",
  },
  {
    name: "Institutional",
    hint: "classification 80",
    address: "0x00000000000000000000000000000000000a0003",
  },
];

const usd = (units: string) => (Number(units) / 1e6).toLocaleString();

export function LiveConsole({
  initialAddress,
  initialReport,
  initialError,
  initialPolicy,
}: {
  initialAddress: string;
  /** Rendered on the server, so the first paint already shows a real verdict — no spinner. */
  initialReport: Report | null;
  initialError: string | null;
  initialPolicy: DemoPolicySnapshot;
}) {
  const [address, setAddress] = useState(initialAddress);
  const [report, setReport] = useState<Report | null>(initialReport);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [policy, setPolicy] = useState(initialPolicy);
  const [policyNotice, setPolicyNotice] = useState<{
    tone: "success" | "warning" | "error";
    message: string;
    txHash?: string;
  } | null>(null);
  const [policyPending, startPolicyTransition] = useTransition();
  const [policyPhase, setPolicyPhase] = useState<"writing" | "rechecking" | null>(null);
  const latestRequest = useRef(0);

  const load = useCallback(async (target: string) => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/operator/${target}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lookup failed.");
      if (requestId !== latestRequest.current) return;
      setReport(data as Report);
    } catch (e) {
      if (requestId !== latestRequest.current) return;
      // Distinguished from "not eligible" on purpose: this is our failure, not the operator's.
      setError(e instanceof Error ? e.message : "Could not reach the compliance validator.");
      setReport(null);
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, []);

  const changePolicy = useCallback(() => {
    const action = policy.state === "default" ? "restrict" : "reset";
    setPolicyNotice(null);
    setPolicyPhase("writing");

    startPolicyTransition(async () => {
      const result = await changeDemoPolicy(action);
      setPolicy({ state: result.state, message: result.message });
      setPolicyNotice({
        tone: result.ok ? (result.confirmed ? "success" : "warning") : "error",
        message: result.message,
        txHash: result.txHash,
      });

      // The write result is not treated as the verdict. Re-read the validator for the selected
      // operator so the number below is always the authoritative post-change decision.
      setPolicyPhase("rechecking");
      await load(address);
      setPolicyPhase(null);
    });
  }, [address, load, policy.state]);

  const retryPolicyRead = useCallback(() => {
    setPolicyNotice(null);
    setPolicyPhase("rechecking");
    startPolicyTransition(async () => {
      const next = await inspectDemoPolicy();
      setPolicy(next);
      if (next.state === "unavailable") {
        setPolicyNotice({ tone: "error", message: next.message });
      }
      setPolicyPhase(null);
    });
  }, []);

  return (
    <div className="px-5 pb-16 sm:px-8">
      {/* ── How to read this page ─────────────────────────────────────────
          The console shows a real credit decision, but nothing on it explains
          itself to a first-time viewer. Three numbered steps, in the order a
          visitor should act, cost one strip and remove the guesswork. */}
      <ol className="mb-4 grid grid-cols-1 border border-white/[0.09] sm:grid-cols-3">
        {[
          {
            n: "01",
            title: "Pick an operator",
            body: "Four real wallets, each with a different verified identity on Cleanverse.",
          },
          {
            n: "02",
            title: "Change the lending rule",
            body: "Restrict band-2 to GB identities. This writes to Cleanverse, not to our contracts.",
          },
          {
            n: "03",
            title: "Watch the limit move",
            body: "The operator's credit changes because their passport no longer matches the rule.",
          },
        ].map((step) => (
          <li
            key={step.n}
            className="border-t border-white/[0.09] p-4 first:border-t-0 sm:border-l sm:border-t-0 first:sm:border-l-0"
          >
            <span className="mono-label text-red">[{step.n}]</span>
            <p className="mt-2 text-sm text-white/85">{step.title}</p>
            <p className="mt-1 text-[0.6875rem] leading-relaxed text-white/40">{step.body}</p>
          </li>
        ))}
      </ol>

      {/* ── Wallet picker ─────────────────────────────────────────────── */}
      <div className="border border-white/[0.09]">
        <div className="flex items-center justify-between border-b border-white/[0.09] px-4 py-2.5">
          <span className="mono-label text-white/40">
            [01] Select an operator wallet
          </span>
          <span className="mono-label hidden text-white/20 sm:block">4 live presets</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {PRESETS.map((p) => {
            const active = p.address.toLowerCase() === address.toLowerCase();
            return (
              <button
                key={p.address}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setAddress(p.address);
                  void load(p.address);
                }}
                className={`border-t border-white/[0.09] p-4 text-left transition-colors first:border-t-0 sm:border-l sm:border-t-0 first:sm:border-l-0 ${
                  active ? "wallet-active bg-red/[0.09]" : "hover:bg-white/[0.03]"
                }`}
              >
                <span className={`mono-label ${active ? "text-red" : "text-white/70"}`}>
                  {p.name}
                </span>
                <p className="mt-1.5 text-[0.6875rem] text-white/40">{p.hint}</p>
                <p className="mt-2 truncate font-mono text-[0.5625rem] text-white/25">
                  {p.address}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Live policy control ──────────────────────────────────────── */}
      <PolicyControl
        policy={policy}
        notice={policyNotice}
        pending={policyPending}
        phase={policyPhase}
        onChange={changePolicy}
        onRetry={retryPolicyRead}
      />

      {/* ── Result ────────────────────────────────────────────────────── */}
      <div className="mt-6">
        {loading ? (
          <div className="mb-3 flex items-center gap-3" role="status" aria-live="polite">
            <span className="h-px flex-1 overflow-hidden bg-white/[0.06]">
              <span className="block h-full w-1/3 animate-pulse bg-red/70" />
            </span>
            <span className="mono-label text-white/30">Re-evaluating</span>
          </div>
        ) : null}

        {loading && !report ? <Skeleton /> : null}

        {!loading && error ? (
          <div className="border border-amber-400/30 bg-amber-400/[0.04] p-5 sm:p-6">
            <span className="mono-label text-amber-300">Check unavailable</span>
            <p className="mt-3 text-sm text-white/60">{error}</p>
            <p className="mt-2 text-xs text-white/35">
              Credit is denied when the validator can&apos;t be reached — an outage must never
              grant access.
            </p>
            <button
              onClick={() => void load(address)}
              className="mono-label mt-6 border border-white/20 px-5 py-3 text-white/80 transition-colors hover:bg-white/5"
            >
              Retry
            </button>
          </div>
        ) : null}

        {!error && report ? (
          <div className={loading ? "pointer-events-none opacity-35 transition-opacity" : "transition-opacity"}>
            <Result key={`${report.address}-${report.band?.label ?? "none"}`} report={report} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PolicyControl({
  policy,
  notice,
  pending,
  phase,
  onChange,
  onRetry,
}: {
  policy: DemoPolicySnapshot;
  notice: {
    tone: "success" | "warning" | "error";
    message: string;
    txHash?: string;
  } | null;
  pending: boolean;
  phase: "writing" | "rechecking" | null;
  onChange: () => void;
  onRetry: () => void;
}) {
  const status = {
    default: "Default · global",
    restricted: "Allow-list · GB only",
    custom: "Custom live rule",
    unavailable: "State unavailable",
  }[policy.state];

  const noticeTone =
    notice?.tone === "success"
      ? "border-emerald-400/25 bg-emerald-400/[0.04] text-emerald-300"
      : "border-amber-400/25 bg-amber-400/[0.04] text-amber-300";

  return (
    <section className="mt-4 border border-white/[0.09]" aria-labelledby="policy-title">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto]">
        <div className="p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <span className="pulse-dot h-1.5 w-1.5 bg-red" aria-hidden="true" />
            <span className="mono-label text-red">Live policy write</span>
          </div>
          <h2 id="policy-title" className="display mt-4 text-xl text-white sm:text-2xl">
            Change the rule. Watch credit move.
          </h2>
          <p className="mt-2 max-w-2xl text-[0.8125rem] leading-relaxed text-white/50">
            Limit band-2 to GB identities on Cleanverse. The Nigerian operator above should drop
            from 2,500 to 500 aUSDC without a contract redeploy.
          </p>
        </div>

        <div className="flex min-w-60 flex-col justify-center border-t border-white/[0.09] p-4 lg:border-l lg:border-t-0 lg:p-5">
          <span className="mono-label text-white/30">Current band-2 policy</span>
          <span className="mt-1.5 font-mono text-xs text-white/80">{status}</span>
          <button
            type="button"
            onClick={policy.state === "unavailable" ? onRetry : onChange}
            disabled={pending}
            className="mono-label mt-4 min-h-10 border border-red/60 bg-red px-4 py-2.5 text-center text-white transition-colors hover:bg-red-bright disabled:cursor-wait disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
          >
            {pending
              ? phase === "rechecking"
                ? "Re-reading verdict…"
                : "Confirming on Monad…"
              : policy.state === "unavailable"
                ? "Re-check policy"
                : policy.state === "default"
                  ? "Restrict to GB only"
                  : "Reset band-2 rule"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 border-t border-white/[0.09] sm:grid-cols-3">
        <PolicyFact index="01" label="Mutation" value="validator / set_rule" />
        <PolicyFact index="02" label="Target" value="band-2 · 2,500 aUSDC" />
        <PolicyFact index="03" label="Contract changes" value="none" />
      </div>

      {pending ? (
        <div className="border-t border-white/[0.09] px-4 py-3" role="status" aria-live="polite">
          <div className="grid grid-cols-2 gap-px bg-white/[0.09]">
            <MutationStep
              index="01"
              label="Submit + confirm"
              active={phase === "writing"}
              complete={phase === "rechecking"}
            />
            <MutationStep
              index="02"
              label="Re-read verdict"
              active={phase === "rechecking"}
              complete={false}
            />
          </div>
          <p className="mt-3 font-mono text-[0.6875rem] text-white/35">
            One write only. Tripwire never retries a submitted rule mutation.
          </p>
        </div>
      ) : null}

      {!pending && notice ? (
        <div className={`border-t px-4 py-3 ${noticeTone}`} role="status" aria-live="polite">
          <p className="font-mono text-xs leading-relaxed">
            {notice.tone === "success" ? "Confirmed · " : "Attention · "}
            {notice.message}
          </p>
          {notice.txHash ? (
            <p className="mt-2 break-all font-mono text-[0.625rem] text-white/35">
              tx {notice.txHash}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function MutationStep({
  index,
  label,
  active,
  complete,
}: {
  index: string;
  label: string;
  active: boolean;
  complete: boolean;
}) {
  return (
    <div className="flex items-center gap-3 bg-[#0b0a0a] px-3 py-2.5">
      <span
        className={`h-1.5 w-1.5 shrink-0 ${
          active ? "pulse-dot bg-red" : complete ? "bg-emerald-400" : "bg-white/15"
        }`}
        aria-hidden
      />
      <span className={`mono-label ${active ? "text-white/75" : "text-white/30"}`}>
        {index} · {label}
      </span>
    </div>
  );
}

function PolicyFact({ index, label, value }: { index: string; label: string; value: string }) {
  return (
    <div className="border-t border-white/[0.09] p-4 first:border-t-0 sm:border-l sm:border-t-0 first:sm:border-l-0">
      <span className="mono-label text-red/70">[{index}] {label}</span>
      <p className="mt-1.5 font-mono text-[0.6875rem] text-white/55">{value}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-busy>
      <div className="h-24 animate-pulse border border-white/[0.09] bg-white/[0.02]" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse border border-white/[0.09] bg-white/[0.02]"
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function Result({ report }: { report: Report }) {
  return (
    <div className="rise space-y-5">
      {/* Headline verdict */}
      <div className="border border-white/[0.09]">
        <div className="decision-trace flex flex-col gap-2 border-b border-white/[0.09] px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <span className="mono-label text-white/30">
            [03] Decision trace · live validator read
          </span>
          <span className="break-all font-mono text-[0.5625rem] text-white/25 sm:break-normal">
            {report.address}
          </span>
        </div>
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
          <div>
            <span className="mono-label text-white/40">Approved credit line</span>
            <p className="display mt-2 text-4xl text-white sm:text-[2.75rem]">
              {report.band ? `${usd(report.band.limit)}` : "0"}
              <span className="ml-2 font-mono text-sm font-normal text-white/35">aUSDC</span>
            </p>
            <p className="mt-2 text-[0.8125rem] text-white/50">{report.summary.message}</p>
          </div>

          {report.apass ? (
            <dl className="grid grid-cols-3 gap-4 sm:text-right">
              <Fact label="Tier" value={String(report.apass.tier)} />
              <Fact label="Class" value={String(report.apass.subTier)} />
              <Fact
                label="Country"
                value={report.apass.countries.join(", ") || "—"}
              />
            </dl>
          ) : (
            <span className="mono-label border border-white/15 px-4 py-2 text-white/40">
              No A&#8209;Pass
            </span>
          )}
        </div>

        {/* The three A-Pass attributes are meaningless jargon without this line. */}
        {report.apass ? (
          <p className="border-t border-white/[0.09] px-4 py-2.5 text-[0.6875rem] leading-relaxed text-white/35">
            <span className="text-white/55">Tier</span> is Cleanverse&apos;s KYC strength ·{" "}
            <span className="text-white/55">Class</span> is the operator classification submitted
            with their documents · <span className="text-white/55">Country</span> is derived from
            the passport itself and is the one value nobody can self-declare.
          </p>
        ) : null}
      </div>

      {/* Per-band ladder */}
      <p className="mt-6 text-[0.8125rem] text-white/45">
        Each band is a separate contract registered with Cleanverse. We ask{" "}
        <span className="font-mono text-white/70">complianceVerify</span> once per band and grant
        the highest one that passes — so a denial always names the band and the shortfall.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
        {report.bands.map((band) => (
          <BandCard key={band.label} band={band} best={report.band?.label === band.label} />
        ))}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="mono-label text-white/30">{label}</dt>
      <dd className="mt-1 font-mono text-base text-white/85">{value}</dd>
    </div>
  );
}

function BandCard({ band, best }: { band: BandVerdict; best: boolean }) {
  return (
    <div
      className={`flex flex-col border p-5 transition-colors ${best ? "verdict-live" : ""} ${
        band.passed
          ? best
            ? "border-red/50 bg-red/[0.07]"
            : "border-emerald-400/25 bg-emerald-400/[0.03]"
          : "border-white/[0.09] bg-white/[0.01]"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`mono-label ${band.passed ? "text-white/85" : "text-white/40"}`}>
          {band.label}
        </span>
        <span
          className={`mono-label ${
            band.passed ? (best ? "text-red" : "text-emerald-300") : "text-white/25"
          }`}
        >
          {band.passed ? (best ? "◆ granted" : "✓ passed") : "✕ denied"}
        </span>
      </div>

      <p className={`display mt-4 text-2xl ${band.passed ? "text-white" : "text-white/30"}`}>
        {usd(band.limit)}
      </p>
      <p className="mono-label mt-1 text-white/30">aUSDC · {band.description}</p>

      <p className="mt-4 text-[0.8125rem] leading-relaxed text-white/50">{band.message}</p>

      {/* The gap, drawn. Turns a rejection into something actionable. */}
      {band.shortfall ? (
        <div className="mt-4">
          <div className="flex justify-between">
            <span className="mono-label text-white/30">{band.shortfall.field}</span>
            <span className="mono-label text-white/45">
              {band.shortfall.actual} / {band.shortfall.required}
            </span>
          </div>
          <div className="mt-2 h-1 w-full bg-white/[0.07]">
            <div
              className="h-full bg-red/70 transition-all duration-700"
              style={{
                width: `${Math.min(100, (band.shortfall.actual / band.shortfall.required) * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      <span className="mono-label mt-auto pt-5 text-[0.5rem] text-white/20">{band.code}</span>
    </div>
  );
}
