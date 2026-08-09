/**
 * Shared building blocks for the landing page.
 *
 * Kept in one file because they are small, purely presentational, and always used together —
 * splitting them across nine files would cost more to read than it saves.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The bordered content column. Every section renders inside one, which is what makes the page
 * read as a single continuous document rather than a stack of unrelated bands.
 */
export function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("frame", className)}>{children}</div>;
}

/** Small bordered pill that names a section. The reference's "× THE PROBLEM" marker. */
export function Eyebrow({ children, icon }: { children: ReactNode; icon?: string }) {
  return (
    <span className="mono-label inline-flex items-center gap-2 border border-red/40 px-3 py-1.5 text-red">
      {icon ? <span aria-hidden>{icon}</span> : null}
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  icon,
  title,
  lede,
  align = "center",
}: {
  eyebrow: string;
  icon?: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: "center" | "left";
}) {
  return (
    <div
      className={cn(
        "px-6 py-16 sm:px-10 md:py-24",
        align === "center" ? "text-center" : "text-left",
      )}
    >
      <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
      <h2 className="display mt-7 text-4xl text-white sm:text-5xl md:text-6xl">{title}</h2>
      {lede ? (
        <p
          className={cn(
            "mt-6 text-base leading-relaxed text-white/55 sm:text-lg",
            align === "center" ? "mx-auto max-w-2xl" : "max-w-2xl",
          )}
        >
          {lede}
        </p>
      ) : null}
    </div>
  );
}

/** Hairline-bordered cell used by the card grids. Borders collapse via negative margins. */
export function Cell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group border-t border-l border-white/[0.09] p-7 transition-colors duration-300 hover:bg-white/[0.02] sm:p-9",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A labelled node in the architecture diagram. */
export function Node({
  label,
  sub,
  tone = "neutral",
  className,
}: {
  label: string;
  sub?: string;
  tone?: "neutral" | "red" | "live";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-[8.5rem] flex-col items-center justify-center border px-4 py-3 text-center",
        tone === "red" && "border-red/50 bg-red/[0.06]",
        tone === "live" && "border-emerald-400/40 bg-emerald-400/[0.05]",
        tone === "neutral" && "border-white/15 bg-white/[0.02]",
        className,
      )}
    >
      <span
        className={cn(
          "mono-label",
          tone === "red" ? "text-red" : tone === "live" ? "text-emerald-300" : "text-white/75",
        )}
      >
        {label}
      </span>
      {sub ? (
        <span className="mono-label mt-1 text-[0.5625rem] tracking-[0.14em] text-white/35">
          {sub}
        </span>
      ) : null}
    </div>
  );
}
