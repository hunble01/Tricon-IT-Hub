"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "accent" | "success" | "warn" | "danger" | "info";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-paper-deep text-ink-soft",
  accent: "bg-accent-wash text-accent-ink",
  success: "bg-accent-wash text-accent",
  warn: "bg-honey-wash text-honey",
  danger: "bg-clay-wash text-clay",
  info: "bg-slatey-wash text-slatey",
};

const DOT_CLASS: Record<Tone, string> = {
  neutral: "bg-ink-faint",
  accent: "bg-accent",
  success: "bg-accent-bright",
  warn: "bg-honey",
  danger: "bg-clay",
  info: "bg-slatey",
};

export function Pill({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("pill", TONE_CLASS[tone], className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASS[tone])} />}
      {children}
    </span>
  );
}

/** A surface card with an optional header (title + meta + actions). */
export function SectionCard({
  title,
  count,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  count?: number;
  actions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("panel overflow-hidden", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="flex items-baseline gap-2 text-[15px] font-semibold text-ink">
            {title}
            {count !== undefined && (
              <span className="font-mono text-xs font-normal text-ink-faint">{count}</span>
            )}
          </h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-paper-deep text-ink-faint">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-field border border-clay/30 bg-clay-wash px-3 py-2 text-xs text-clay">
      {children}
    </div>
  );
}

// ---- domain badge tones --------------------------------------------------

export function employmentBadge(value: string): { tone: Tone; label: string } {
  const map: Record<string, { tone: Tone; label: string }> = {
    ONBOARDING: { tone: "warn", label: "Onboarding" },
    ACTIVE: { tone: "success", label: "Active" },
    NO_SHOW: { tone: "danger", label: "No show" },
    DEPARTED: { tone: "neutral", label: "Departed" },
  };
  return map[value] ?? { tone: "neutral", label: value };
}

export function sourceBadge(value: string): { tone: Tone; label: string } {
  const map: Record<string, { tone: Tone; label: string }> = {
    ONBOARDING: { tone: "info", label: "Onboarding" },
    TICKET: { tone: "accent", label: "Ticket" },
    MANUAL: { tone: "neutral", label: "Manual" },
  };
  return map[value] ?? { tone: "neutral", label: value };
}

export function deviceBadge(value: string): { tone: Tone; label: string } {
  const map: Record<string, { tone: Tone; label: string }> = {
    IN_STOCK: { tone: "success", label: "In stock" },
    ASSIGNED: { tone: "info", label: "Assigned" },
    RETURNED: { tone: "warn", label: "Returned" },
    IN_REPAIR: { tone: "warn", label: "In repair" },
    RETIRED: { tone: "neutral", label: "Retired" },
  };
  return map[value] ?? { tone: "neutral", label: value };
}

export function ticketBadge(value: string): { tone: Tone; label: string } {
  const map: Record<string, { tone: Tone; label: string }> = {
    OPEN: { tone: "info", label: "Open" },
    PENDING: { tone: "warn", label: "Pending" },
    RESOLVED: { tone: "success", label: "Resolved" },
  };
  return map[value] ?? { tone: "neutral", label: value };
}

export function onboardingDeviceBadge(value: string): { tone: Tone; label: string } {
  const map: Record<string, { tone: Tone; label: string }> = {
    PENDING: { tone: "warn", label: "Devices pending" },
    ALREADY_SET_UP: { tone: "info", label: "Already set up" },
    DONE: { tone: "success", label: "Devices done" },
  };
  return map[value] ?? { tone: "neutral", label: value };
}

/** Count-up hook for hero numerals. */
export function useCountUp(target: number | undefined, duration = 900): number {
  const [value, setValue] = React.useState(0);
  React.useEffect(() => {
    if (target === undefined) return;
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}
