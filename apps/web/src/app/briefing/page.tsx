"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Newspaper, RefreshCw, AlertTriangle, Clock, Ticket as TicketIcon,
  UserPlus, UserMinus, PackageCheck, ShoppingCart,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, ErrorNote, SectionCard, type Tone } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

interface SlaTicket {
  id: string; subject: string; source: string; priority: string;
  status: string; hoursLeft: number | null; assignedTo: string | null; requester: string | null;
}
interface Briefing {
  generatedAt: string;
  headline: string;
  sections: {
    tickets: { open: number; unassigned: number; breached: number; atRisk: number; topAtRisk: SlaTicket[] };
    onboarding: { arrivingThisWeek: number; overdue: number; items: Array<{ name: string; startDate: string | null; deviceStatus: string; overdue: boolean }> };
    offboarding: { inProgress: number; leavingThisWeek: number; gearToReclaim: number; items: Array<{ name: string; lastDay: string | null; status: string; gearOut: number }> };
    inventory: { departedHolding: number; toOrder: Array<{ label: string; meta?: string }> };
    alerts: { summary: { high: number; medium: number; low: number; total: number }; digest: string };
  };
}

export default function BriefingPage() {
  return (
    <AppShell eyebrow="Today" title="Daily Briefing">
      {() => <BriefingView />}
    </AppShell>
  );
}

function BriefingView() {
  const [data, setData] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setData(await api<Briefing>("/briefing"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load briefing");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  if (loading) return <div className="panel px-5 py-16 text-center text-sm text-ink-soft">Loading briefing…</div>;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return null;

  const s = data.sections;

  return (
    <div className="space-y-5">
      {/* Headline */}
      <div className="animate-rise overflow-hidden rounded-card border border-accent/20 bg-accent-wash shadow-soft">
        <div className="flex items-start gap-3 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white">
            <Newspaper size={18} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-accent-ink">{data.headline}</p>
            <p className="mt-0.5 text-xs text-ink-soft">{s.alerts.digest}</p>
          </div>
          <button onClick={refresh} className="btn-ghost px-2.5 py-1 text-xs">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<AlertTriangle size={15} />} tone="danger" value={s.tickets.breached} label="Past SLA" href="/tickets" />
        <Stat icon={<Clock size={15} />} tone="warn" value={s.tickets.atRisk} label="Nearing SLA" href="/tickets" />
        <Stat icon={<TicketIcon size={15} />} tone="info" value={s.tickets.unassigned} label="Unassigned" href="/tickets" />
        <Stat icon={<PackageCheck size={15} />} tone="accent" value={s.offboarding.gearToReclaim} label="Gear to reclaim" href="/offboarding" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Tickets needing attention */}
        <SectionCard title="Tickets against SLA" count={s.tickets.topAtRisk.length}>
          {s.tickets.topAtRisk.length === 0 ? (
            <Empty>All open tickets are within SLA.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {s.tickets.topAtRisk.map((t) => (
                <li key={t.id}>
                  <Link href="/tickets" className="block px-5 py-3 transition hover:bg-paper-deep/40">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">{t.subject}</span>
                      <Pill tone={t.hoursLeft != null && t.hoursLeft < 0 ? "danger" : "warn"}>
                        {t.hoursLeft != null ? `${Math.round(t.hoursLeft)}h` : "—"}
                      </Pill>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-faint">
                      {t.priority.toLowerCase()} · {t.assignedTo ? `→ ${t.assignedTo}` : "unassigned"} · {t.requester ?? "unlinked"}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* What to order */}
        <SectionCard title="To order" count={s.inventory.toOrder.length}>
          {s.inventory.toOrder.length === 0 ? (
            <Empty>Stock covers upcoming demand.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {s.inventory.toOrder.map((i, idx) => (
                <li key={idx} className="flex items-center gap-2 px-5 py-3 text-sm">
                  <ShoppingCart size={14} className="text-honey" />
                  <span className="font-medium capitalize text-ink">{i.label}</span>
                  {i.meta && <span className="text-xs text-ink-faint">{i.meta}</span>}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Onboarding this week */}
        <SectionCard
          title="Onboarding"
          actions={<span className="text-xs text-ink-soft">{s.onboarding.overdue} overdue · {s.onboarding.arrivingThisWeek} this week</span>}
        >
          {s.onboarding.items.length === 0 ? (
            <Empty>No hires arriving or overdue.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {s.onboarding.items.map((o, idx) => (
                <li key={idx} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span className="flex items-center gap-2">
                    <UserPlus size={14} className="text-ink-faint" />
                    <span className="font-medium text-ink">{o.name}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    {o.startDate && <span className="text-ink-faint">{new Date(o.startDate).toLocaleDateString()}</span>}
                    {o.overdue && <Pill tone="danger">overdue</Pill>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Offboarding */}
        <SectionCard
          title="Offboarding"
          actions={<span className="text-xs text-ink-soft">{s.offboarding.inProgress} active · {s.offboarding.leavingThisWeek} this week</span>}
        >
          {s.offboarding.items.length === 0 ? (
            <Empty>No leavers in progress.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {s.offboarding.items.map((o, idx) => (
                <li key={idx} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span className="flex items-center gap-2">
                    <UserMinus size={14} className="text-ink-faint" />
                    <span className="font-medium text-ink">{o.name}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    {o.lastDay && <span className="text-ink-faint">{new Date(o.lastDay).toLocaleDateString()}</span>}
                    {o.gearOut > 0 && <Pill tone="warn">{o.gearOut} gear out</Pill>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function Stat({ icon, tone, value, label, href }: { icon: React.ReactNode; tone: Tone; value: number; label: string; href: string }) {
  const toneClass: Record<string, string> = {
    danger: "text-clay", warn: "text-honey", info: "text-slatey", accent: "text-accent", neutral: "text-ink-soft", success: "text-accent",
  };
  return (
    <Link href={href} className="hover-lift panel-raised flex items-center gap-3 px-4 py-3.5">
      <span className={toneClass[tone]}>{icon}</span>
      <div>
        <div className="numeral text-xl font-semibold text-ink">{value}</div>
        <div className="text-[11px] text-ink-soft">{label}</div>
      </div>
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-8 text-center text-sm text-ink-soft">{children}</div>;
}
