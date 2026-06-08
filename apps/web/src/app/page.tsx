"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  Laptop,
  UserPlus,
  Ticket,
  ArrowUpRight,
  Building2,
  Briefcase,
  BookOpen,
  Brain,
  AlertTriangle,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, useCountUp, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Summary {
  staff: { total: number; byStatus: Record<string, number> };
  devices: { total: number; byStatus: Record<string, number> };
  onboardings: { total: number; byDeviceStatus: Record<string, number> };
  tickets: { total: number; byStatus: Record<string, number> };
  catalog: { buildings: number; roles: number; knowledgeArticles: number; memoryEntries: number };
}

interface Activity {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actor: string;
  createdAt: string;
}

export default function HomePage() {
  return (
    <AppShell eyebrow="Overview" title="Operations">
      {(user) => <Dashboard firstName={user.name.split(" ")[0] ?? user.name} />}
    </AppShell>
  );
}

interface AlertsBrief {
  summary: { high: number; medium: number; low: number; total: number };
  digest: string;
}

function Dashboard({ firstName }: { firstName: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [alerts, setAlerts] = useState<AlertsBrief | null>(null);

  useEffect(() => {
    api<Summary>("/dashboard/summary").then(setSummary).catch(() => setSummary(null));
    api<Activity[]>("/dashboard/activity?limit=14").then(setActivity).catch(() => setActivity([]));
    api<AlertsBrief>("/alerts").then(setAlerts).catch(() => setAlerts(null));
  }, []);

  const pending = summary?.onboardings.byDeviceStatus.PENDING ?? 0;
  const open = summary?.tickets.byStatus.OPEN ?? 0;

  return (
    <div className="space-y-7">
      <Hero
        firstName={firstName}
        staff={summary?.staff.total}
        sites={summary?.catalog.buildings}
        pending={pending}
        open={open}
      />

      {alerts && alerts.summary.total > 0 && <AlertsBanner data={alerts} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          i={0}
          href="/staff"
          icon={Users}
          label="Staff supported"
          total={summary?.staff.total}
          breakdown={summary?.staff.byStatus}
        />
        <Kpi
          i={1}
          href="/devices"
          icon={Laptop}
          label="Devices tracked"
          total={summary?.devices.total}
          breakdown={summary?.devices.byStatus}
        />
        <Kpi
          i={2}
          href="/onboarding"
          icon={UserPlus}
          label="Onboardings"
          total={summary?.onboardings.total}
          breakdown={summary?.onboardings.byDeviceStatus}
        />
        <Kpi
          i={3}
          href="/tickets"
          icon={Ticket}
          label="Tickets"
          total={summary?.tickets.total}
          breakdown={summary?.tickets.byStatus}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
        <ActivityFeed items={activity} />
        <Library catalog={summary?.catalog} />
      </div>
    </div>
  );
}

function AlertsBanner({ data }: { data: AlertsBrief }) {
  return (
    <Link
      href="/alerts"
      className="stagger hover-lift group flex items-center gap-4 rounded-card border border-clay/25 bg-clay-wash px-5 py-4 shadow-soft"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-clay text-white">
        <AlertTriangle size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink">
          {data.summary.high > 0 ? `${data.summary.high} urgent · ` : ""}
          {data.summary.total} thing{data.summary.total === 1 ? "" : "s"} need attention
        </div>
        <div className="truncate text-xs text-ink-soft">{data.digest}</div>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-clay">
        Review <ChevronRight size={14} className="transition group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function greetingFor(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function Hero({
  firstName,
  staff,
  sites,
  pending,
  open,
}: {
  firstName: string;
  staff?: number;
  sites?: number;
  pending: number;
  open: number;
}) {
  const [greeting, setGreeting] = useState("Welcome");
  useEffect(() => setGreeting(greetingFor()), []);

  return (
    <div className="stagger relative overflow-hidden rounded-card border border-line bg-surface-raised shadow-card">
      {/* Architectural rooftop motif, faint, bleeding off the right edge. */}
      <svg
        className="pointer-events-none absolute -right-6 -top-8 h-[150%] w-[420px] text-accent/[0.05]"
        viewBox="0 0 400 300"
        fill="none"
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4].map((r) => (
          <path
            key={r}
            d={`M${-40 + r * 22} 300 L${80 + r * 22} 60 L${200 + r * 22} 300`}
            stroke="currentColor"
            strokeWidth="2"
          />
        ))}
      </svg>
      <div className="absolute inset-0 bg-gradient-to-r from-accent-wash/40 to-transparent" />

      <div className="relative flex flex-col gap-6 px-7 py-7 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow mb-2">{greeting}</p>
          <h2 className="font-display text-4xl font-semibold leading-[1.05] text-ink">
            {firstName}.
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
            Tricon IT is supporting{" "}
            <strong className="font-semibold text-ink">{staff ?? "—"}</strong> people across{" "}
            <strong className="font-semibold text-ink">{sites ?? "—"}</strong> sites. There{" "}
            {pending === 1 ? "is" : "are"}{" "}
            <strong className="font-semibold text-ink">{pending}</strong> onboarding
            {pending === 1 ? "" : "s"} in motion and{" "}
            <strong className="font-semibold text-ink">{open}</strong> open ticket
            {open === 1 ? "" : "s"}.
          </p>
        </div>

        <div className="flex gap-3">
          <AttentionChip label="Onboardings in motion" value={pending} href="/onboarding" tone="warn" />
          <AttentionChip label="Open tickets" value={open} href="/tickets" tone="info" />
        </div>
      </div>
    </div>
  );
}

function AttentionChip({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  tone: Tone;
}) {
  const ring: Record<string, string> = {
    warn: "border-honey/30 bg-honey-wash",
    info: "border-slatey/25 bg-slatey-wash",
  };
  return (
    <Link
      href={href}
      className={cn(
        "hover-lift flex w-32 flex-col justify-between rounded-card border p-3.5 shadow-soft",
        ring[tone],
      )}
    >
      <span className="numeral text-3xl font-semibold text-ink">{value}</span>
      <span className="mt-2 text-[11px] font-medium leading-tight text-ink-soft">{label}</span>
    </Link>
  );
}

function Kpi({
  i,
  href,
  icon: Icon,
  label,
  total,
  breakdown,
}: {
  i: number;
  href: string;
  icon: LucideIcon;
  label: string;
  total: number | undefined;
  breakdown: Record<string, number> | undefined;
}) {
  const count = useCountUp(total);
  return (
    <Link
      href={href}
      style={{ ["--i" as string]: i + 1 }}
      className="stagger hover-lift group flex flex-col rounded-card border border-line bg-surface-raised p-5 shadow-soft hover:border-line-strong hover:shadow-card"
    >
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-accent-wash text-accent">
          <Icon size={17} strokeWidth={2} />
        </div>
        <ArrowUpRight
          size={16}
          className="text-ink-faint opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100"
        />
      </div>
      <div className="mt-4 numeral text-[40px] font-semibold leading-none text-ink">
        {total === undefined ? <span className="text-ink-faint">—</span> : count}
      </div>
      <div className="mt-1 text-[13px] font-medium text-ink-soft">{label}</div>
      {breakdown && Object.keys(breakdown).length > 0 && (
        <div className="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3">
          {Object.entries(breakdown)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([k, v], idx) => (
              <span key={k} className="flex items-center gap-2 font-mono text-[10.5px] text-ink-faint">
                {idx > 0 && <span className="text-line-strong">·</span>}
                <span>
                  <span className="text-ink-soft">{v}</span> {k.toLowerCase().replace(/_/g, " ")}
                </span>
              </span>
            ))}
        </div>
      )}
    </Link>
  );
}

function actionTone(action: string): Tone {
  if (action.startsWith("onboarding")) return "accent";
  if (action.startsWith("ticket")) return "info";
  if (action.startsWith("device")) return "warn";
  if (action.startsWith("staff")) return "success";
  return "neutral";
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

const DOT: Record<Tone, string> = {
  neutral: "bg-ink-faint",
  accent: "bg-accent",
  success: "bg-accent-bright",
  warn: "bg-honey",
  danger: "bg-clay",
  info: "bg-slatey",
};

function ActivityFeed({ items }: { items: Activity[] }) {
  return (
    <section className="stagger panel" style={{ ["--i" as string]: 5 }}>
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-[15px] font-semibold text-ink">Recent activity</h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
          Audit trail
        </span>
      </header>
      <div className="px-5 py-4">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-soft">No activity recorded yet.</p>
        ) : (
          <ol className="relative space-y-4 before:absolute before:left-[5px] before:top-1.5 before:h-[calc(100%-1rem)] before:w-px before:bg-line">
            {items.map((a) => {
              const tone = actionTone(a.action);
              return (
                <li key={a.id} className="relative flex items-start gap-4 pl-6">
                  <span
                    className={cn(
                      "absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full ring-4 ring-surface",
                      DOT[tone],
                    )}
                  />
                  <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[11px] text-ink">
                        {a.action}
                      </code>
                      <span className="text-xs text-ink-soft">
                        {a.entityType}
                        {a.entityId ? ` · ${a.entityId.slice(0, 7)}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-ink-faint">
                      <span>{a.actor}</span>
                      <span className="text-line-strong">·</span>
                      <time dateTime={a.createdAt}>{relativeTime(a.createdAt)}</time>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

function Library({ catalog }: { catalog?: Summary["catalog"] }) {
  const rows: Array<{ icon: LucideIcon; label: string; value?: number; note: string }> = [
    { icon: Building2, label: "Buildings", value: catalog?.buildings, note: "sites supported" },
    { icon: Briefcase, label: "Roles", value: catalog?.roles, note: "with device profiles" },
    { icon: BookOpen, label: "Knowledge", value: catalog?.knowledgeArticles, note: "KB articles" },
    { icon: Brain, label: "AI memory", value: catalog?.memoryEntries, note: "embedded entries" },
  ];
  return (
    <section className="stagger panel" style={{ ["--i" as string]: 6 }}>
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-[15px] font-semibold text-ink">Library &amp; memory</h2>
      </header>
      <div className="divide-y divide-line">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.label} className="flex items-center gap-3 px-5 py-3.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-paper-deep text-ink-soft">
                <Icon size={15} />
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-medium text-ink">{r.label}</div>
                <div className="text-[11px] text-ink-faint">{r.note}</div>
              </div>
              <div className="numeral text-2xl font-semibold text-ink">
                {r.value ?? <span className="text-ink-faint">—</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
