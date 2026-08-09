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

import { useCallback, useState } from "react";

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
}: {
  initialAddress: string;
  /** Rendered on the server, so the first paint already shows a real verdict — no spinner. */
  initialReport: Report | null;
  initialError: string | null;
}) {
  const [address, setAddress] = useState(initialAddress);
  const [report, setReport] = useState<Report | null>(initialReport);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/operator/${target}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lookup failed.");
      setReport(data as Report);
    } catch (e) {
      // Distinguished from "not eligible" on purpose: this is our failure, not the operator's.
      setError(e instanceof Error ? e.message : "Could not reach the compliance validator.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="px-6 pb-24 sm:px-10">
      {/* ── Wallet picker ─────────────────────────────────────────────── */}
      <div className="border border-white/[0.09]">
        <div className="border-b border-white/[0.09] px-5 py-3">
          <span className="mono-label text-white/40">Select an operator wallet</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {PRESETS.map((p) => {
            const active = p.address.toLowerCase() === address.toLowerCase();
            return (
              <button
                key={p.address}
                onClick={() => {
                  setAddress(p.address);
                  void load(p.address);
                }}
                className={`border-white/[0.09] p-5 text-left transition-colors sm:border-l first:sm:border-l-0 ${
                  active ? "bg-red/[0.09]" : "hover:bg-white/[0.03]"
                }`}
              >
                <span className={`mono-label ${active ? "text-red" : "text-white/70"}`}>
                  {p.name}
                </span>
                <p className="mt-2 text-xs text-white/40">{p.hint}</p>
                <p className="mt-3 truncate font-mono text-[0.625rem] text-white/25">
                  {p.address}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Result ────────────────────────────────────────────────────── */}
      <div className="mt-10">
        {loading ? <Skeleton /> : null}

        {!loading && error ? (
          <div className="border border-amber-400/30 bg-amber-400/[0.04] p-8">
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

        {!loading && !error && report ? <Result report={report} /> : null}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="h-32 animate-pulse border border-white/[0.09] bg-white/[0.02]" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-40 animate-pulse border border-white/[0.09] bg-white/[0.02]"
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function Result({ report }: { report: Report }) {
  return (
    <div className="rise space-y-8">
      {/* Headline verdict */}
      <div className="border border-white/[0.09]">
        <div className="flex flex-col gap-6 p-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="mono-label text-white/40">Approved credit line</span>
            <p className="display mt-3 text-5xl text-white sm:text-6xl">
              {report.band ? `${usd(report.band.limit)}` : "0"}
              <span className="ml-3 font-mono text-lg font-normal text-white/35">aUSDC</span>
            </p>
            <p className="mt-3 text-sm text-white/50">{report.summary.message}</p>
          </div>

          {report.apass ? (
            <dl className="grid grid-cols-3 gap-6 sm:text-right">
              <Fact label="Tier" value={String(report.apass.tier)} />
              <Fact label="Class" value={String(report.apass.subTier)} />
              <Fact
                label="Country"
                value={report.apass.countries.join(", ") || "—"}
              />
            </dl>
          ) : (
            <span className="mono-label border border-white/15 px-4 py-2 text-white/40">
              No A-Pass
            </span>
          )}
        </div>
      </div>

      {/* Per-band ladder */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
      <dd className="mt-1 font-mono text-lg text-white/85">{value}</dd>
    </div>
  );
}

function BandCard({ band, best }: { band: BandVerdict; best: boolean }) {
  return (
    <div
      className={`flex flex-col border p-6 transition-colors ${
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

      <p
        className={`display mt-5 text-3xl ${band.passed ? "text-white" : "text-white/30"}`}
      >
        {usd(band.limit)}
      </p>
      <p className="mono-label mt-1 text-white/30">aUSDC · {band.description}</p>

      <p className="mt-5 text-sm leading-relaxed text-white/50">{band.message}</p>

      {/* The gap, drawn. Turns a rejection into something actionable. */}
      {band.shortfall ? (
        <div className="mt-5">
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

      <span className="mono-label mt-auto pt-6 text-[0.5625rem] text-white/20">{band.code}</span>
    </div>
  );
}
