/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

"use client";

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CheckCircle,
  Clock,
  Github,
  Hash,
  LockKeyhole,
  ShieldCheck,
  ThumbsUp,
  Wallet,
} from "lucide-react";

const NAV_LINKS = [
  { label: "Home", href: "#" },
  { label: "How it Works", href: "#how-it-works" },
  { label: "Docs", href: "#docs" },
  { label: "GitHub", href: "https://github.com/tripwire-labs/Tripwire" },
];

const SIGNALS = [
  {
    icon: BadgeCheck,
    title: "ERC-8004 Attestation",
    subtitle: "validator signal",
    x: "left-[11%]",
  },
  {
    icon: ThumbsUp,
    title: "Buyer Confirmation",
    subtitle: "explicit approval",
    x: "left-[36%]",
  },
  {
    icon: Clock,
    title: "Timeout",
    subtitle: "release window",
    x: "left-[61%]",
  },
  {
    icon: Hash,
    title: "Deliverable Hash",
    subtitle: "proof anchor",
    x: "left-[86%]",
  },
];

type DiagramCardTone = "default" | "hub" | "release" | "slash";

function NavBar() {
  return (
    <header className="relative z-20">
      <div className="mx-auto grid max-w-7xl grid-cols-2 items-center px-5 py-6 sm:px-8 lg:grid-cols-[1fr_auto_1fr]">
        <a href="#" className="text-lg font-bold tracking-[-0.01em] text-white">
          Tripwire
        </a>

        <nav className="hidden items-center justify-center gap-9 lg:flex">
          {NAV_LINKS.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="font-mono text-[12px] text-neutral-400 transition-colors hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex justify-end">
          <a
            href="https://github.com/tripwire-labs/Tripwire"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 bg-neutral-950/70 px-4 font-mono text-[12px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors hover:border-lime-300/45 hover:bg-neutral-900"
          >
            <Github className="h-3.5 w-3.5" />
            View on GitHub
          </a>
        </div>
      </div>

      <nav className="mx-auto flex max-w-sm items-center justify-center gap-5 px-5 pb-5 lg:hidden">
        {NAV_LINKS.slice(0, 3).map((item) => (
          <a
            key={item.label}
            href={item.href}
            className="font-mono text-[11px] text-neutral-500 transition-colors hover:text-neutral-200"
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}

function HeroCopy() {
  return (
    <section className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-5 pb-8 pt-8 text-center sm:pb-10 sm:pt-12">
      <div className="mb-5 rounded-full border border-white/10 bg-white/[0.045] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-neutral-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        ARC HACKATHON · AGENTIC ECONOMY TRACK
      </div>

      <h1 className="max-w-5xl text-balance text-[56px] font-semibold leading-[0.9] tracking-[0em] text-white sm:text-[82px] lg:text-[104px]">
        <span className="bg-gradient-to-b from-white via-neutral-100 to-neutral-500 bg-clip-text text-transparent">
          Pay On <span className="text-lime-300">Proof</span>,
        </span>
        <br />
        <span className="bg-gradient-to-b from-white via-neutral-100 to-neutral-500 bg-clip-text text-transparent">
          Not On Promise.
        </span>
      </h1>

      <p className="mt-7 max-w-2xl text-balance text-[15px] leading-7 text-neutral-400 sm:text-base">
        Escrow-backed settlement for agent-to-agent USDC payments on Arc - payment
        releases only on verified delivery, backed by a slashable seller bond.
      </p>

      <a
        href="#how-it-works"
        className="mt-8 inline-flex h-12 items-center gap-2 rounded-lg border border-white/15 bg-neutral-950 px-5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_40px_rgba(0,0,0,0.45)] transition-colors hover:border-lime-300/45 hover:bg-neutral-900"
      >
        See How It Works
        <ArrowRight className="h-4 w-4" />
      </a>
    </section>
  );
}

function IconTile({
  icon: Icon,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: DiagramCardTone;
}) {
  const toneClass =
    tone === "hub"
      ? "border-lime-300/35 bg-lime-300/[0.08] text-lime-300"
      : tone === "release"
        ? "border-lime-300/25 bg-lime-300/[0.06] text-lime-300"
        : tone === "slash"
          ? "border-neutral-600 bg-neutral-900 text-neutral-300"
          : "border-white/10 bg-white/[0.035] text-neutral-300";

  return (
    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${toneClass}`}>
      <Icon className="h-5 w-5" />
    </div>
  );
}

function DiagramCard({
  icon,
  title,
  subtitle,
  tone = "default",
  className = "",
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  tone?: DiagramCardTone;
  className?: string;
}) {
  const frameClass =
    tone === "hub"
      ? "border-lime-300/45 bg-neutral-950/95 shadow-[0_0_45px_rgba(190,242,100,0.08),inset_0_1px_0_rgba(255,255,255,0.06)] [background-image:radial-gradient(rgba(190,242,100,0.16)_1px,transparent_1px)] [background-size:10px_10px]"
      : "border-white/10 bg-neutral-950/92 shadow-[0_18px_50px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.05)]";

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 backdrop-blur-md ${frameClass} ${className}`}
    >
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0 text-left">
        <div className="truncate text-sm font-semibold tracking-[0em] text-neutral-100">{title}</div>
        <div className="mt-1 truncate font-mono text-[11px] text-neutral-500">{subtitle}</div>
      </div>
    </div>
  );
}

function DesktopDiagram() {
  return (
    <div className="relative mx-auto hidden h-[455px] max-w-5xl md:block">
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <marker id="tripwire-arrow-muted" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#525252" />
          </marker>
          <marker id="tripwire-arrow-lime" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#bef264" />
          </marker>
          <filter id="tripwire-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d="M 196 150 H 419"
          fill="none"
          stroke="#bef264"
          strokeOpacity="0.55"
          strokeWidth="1.4"
          markerEnd="url(#tripwire-arrow-lime)"
          filter="url(#tripwire-glow)"
        />

        <path
          d="M 615 139 C 690 132 704 75 782 72"
          fill="none"
          stroke="#bef264"
          strokeOpacity="0.55"
          strokeWidth="1.4"
          markerEnd="url(#tripwire-arrow-lime)"
        />
        <path
          d="M 615 161 C 690 178 704 235 782 238"
          fill="none"
          stroke="#525252"
          strokeOpacity="0.75"
          strokeWidth="1.4"
          markerEnd="url(#tripwire-arrow-muted)"
        />

        <path d="M 500 258 V 205" fill="none" stroke="#bef264" strokeOpacity="0.5" strokeWidth="1.4" markerEnd="url(#tripwire-arrow-lime)" />
        <path d="M 140 370 C 190 370 222 258 500 258" fill="none" stroke="#525252" strokeOpacity="0.72" strokeWidth="1.4" />
        <path d="M 375 370 C 398 370 410 258 500 258" fill="none" stroke="#525252" strokeOpacity="0.72" strokeWidth="1.4" />
        <path d="M 610 370 C 592 370 584 258 500 258" fill="none" stroke="#525252" strokeOpacity="0.72" strokeWidth="1.4" />
        <path d="M 845 370 C 800 370 773 258 500 258" fill="none" stroke="#525252" strokeOpacity="0.72" strokeWidth="1.4" />
      </svg>

      <DiagramCard
        icon={Wallet}
        title="Buyer Deposit"
        subtitle="starts a job"
        className="absolute left-[3%] top-[150px] w-[190px] -translate-y-1/2"
      />

      <DiagramCard
        icon={LockKeyhole}
        title="JobEscrow"
        subtitle="Settlement Contract"
        tone="hub"
        className="absolute left-[52%] top-[150px] w-[235px] -translate-x-1/2 -translate-y-1/2"
      />

      <span className="absolute left-[70.5%] top-[151px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-black px-2.5 py-1 font-mono text-[10px] text-neutral-500">
        Verified?
      </span>

      <DiagramCard
        icon={CheckCircle}
        title="Release to Seller"
        subtitle="verified delivery"
        tone="release"
        className="absolute right-[2%] top-[72px] w-[205px] -translate-y-1/2"
      />

      <DiagramCard
        icon={AlertTriangle}
        title="Slash + Refund"
        subtitle="bond-backed failure"
        tone="slash"
        className="absolute right-[2%] top-[238px] w-[205px] -translate-y-1/2"
      />

      {SIGNALS.map((item) => (
        <DiagramCard
          key={item.title}
          icon={item.icon}
          title={item.title}
          subtitle={item.subtitle}
          className={`absolute top-[370px] w-[190px] -translate-x-1/2 -translate-y-1/2 ${item.x}`}
        />
      ))}
    </div>
  );
}

function MobileDiagram() {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 md:hidden">
      <DiagramCard icon={Wallet} title="Buyer Deposit" subtitle="starts a job" className="w-full" />
      <div className="h-5 w-px bg-lime-300/45" />
      <DiagramCard icon={LockKeyhole} title="JobEscrow" subtitle="Settlement Contract" tone="hub" className="w-full" />
      <div className="grid w-full grid-cols-2 gap-3 pt-1">
        <DiagramCard icon={CheckCircle} title="Release" subtitle="verified" tone="release" className="min-w-0 px-3" />
        <DiagramCard icon={AlertTriangle} title="Slash" subtitle="refund" tone="slash" className="min-w-0 px-3" />
      </div>
      <div className="pt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-neutral-500">Verification inputs</div>
      {SIGNALS.map((item) => (
        <DiagramCard key={item.title} icon={item.icon} title={item.title} subtitle={item.subtitle} className="w-full" />
      ))}
    </div>
  );
}

function WorkflowDiagram() {
  return (
    <section id="how-it-works" className="relative z-10 mx-auto max-w-6xl px-5 pb-20">
      <DesktopDiagram />
      <MobileDiagram />
    </section>
  );
}

export default function TripwireHero() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-black font-sans text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,rgba(255,255,255,0.7)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.7)_1px,transparent_1px)] [background-size:72px_72px]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.22),rgba(255,255,255,0.08)_24%,rgba(0,0,0,0)_62%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(190,242,100,0.055),transparent_32%),linear-gradient(to_bottom,rgba(0,0,0,0)_0%,rgba(0,0,0,0.74)_78%,#000_100%)]"
        aria-hidden="true"
      />

      <NavBar />
      <HeroCopy />
      <WorkflowDiagram />
    </main>
  );
}
