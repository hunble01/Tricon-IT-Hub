"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ShieldCheck, ChevronRight, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Severity = "high" | "medium" | "low";
interface AlertItem { label: string; meta?: string; href?: string }
interface Alert {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  count: number;
  items: AlertItem[];
}
interface AlertsResponse {
  generatedAt: string;
  summary: { high: number; medium: number; low: number; total: number };
  digest: string;
  alerts: Alert[];
}

const SEV: Record<Severity, { tone: Tone; ring: string; dot: string; label: string }> = {
  high: { tone: "danger", ring: "border-clay/30", dot: "bg-clay", label: "Urgent" },
  medium: { tone: "warn", ring: "border-honey/30", dot: "bg-honey", label: "Watch" },
  low: { tone: "info", ring: "border-slatey/25", dot: "bg-slatey", label: "FYI" },
};

export default function AlertsPage() {
  return (
    <AppShell eyebrow="Intelligence" title="Alerts">
      {() => <AlertsView />}
    </AppShell>
  );
}

function AlertsView() {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setData(await api<AlertsResponse>("/alerts"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  if (loading && !data) {
    return <div className="panel px-5 py-12 text-center text-sm text-ink-soft">Scanning…</div>;
  }
  if (!data) return null;

  const clear = data.alerts.length === 0;

  return (
    <div className="space-y-5">
      {/* Digest banner */}
      <div className={cn(
        "relative overflow-hidden rounded-card border p-6 shadow-card",
        clear ? "border-accent/20 bg-accent-wash" : "border-line bg-surface-raised",
      )}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={cn(
              "flex h-11 w-11 items-center justify-center rounded-[12px]",
              clear ? "bg-accent text-white" : "bg-clay text-white",
            )}>
              {clear ? <ShieldCheck size={20} /> : <AlertTriangle size={20} />}
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-ink">
                {clear ? "All clear" : "Needs your attention"}
              </h2>
              <p className="mt-1 max-w-xl text-sm text-ink-soft">{data.digest}</p>
            </div>
          </div>
          <button onClick={load} className="btn-ghost px-2.5 py-1.5 text-xs">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Rescan
          </button>
        </div>
        {!clear && (
          <div className="mt-4 flex flex-wrap gap-2">
            {data.summary.high > 0 && <Tally n={data.summary.high} label="urgent" sev="high" />}
            {data.summary.medium > 0 && <Tally n={data.summary.medium} label="to watch" sev="medium" />}
            {data.summary.low > 0 && <Tally n={data.summary.low} label="fyi" sev="low" />}
          </div>
        )}
      </div>

      {/* Alert cards */}
      {data.alerts.map((a) => {
        const sev = SEV[a.severity];
        return (
          <section key={a.id} className={cn("panel overflow-hidden border-l-[3px]", sev.ring)} style={{ borderLeftColor: "currentColor" }}>
            <header className={cn("flex items-start justify-between gap-3 px-5 py-3.5", a.severity === "high" ? "text-clay" : a.severity === "medium" ? "text-honey" : "text-slatey")}>
              <div className="flex items-start gap-2.5">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", sev.dot)} />
                <div>
                  <h3 className="text-[15px] font-semibold text-ink">{a.title}</h3>
                  <p className="mt-0.5 text-xs text-ink-soft">{a.detail}</p>
                </div>
              </div>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-faint">{a.category}</span>
            </header>
            <ul className="divide-y divide-line border-t border-line">
              {a.items.map((it, i) => {
                const inner = (
                  <div className="flex items-center justify-between gap-2 px-5 py-2.5">
                    <span className="text-sm text-ink">{it.label}</span>
                    <span className="flex items-center gap-2 text-xs text-ink-faint">
                      {it.meta}
                      {it.href && <ChevronRight size={14} />}
                    </span>
                  </div>
                );
                return (
                  <li key={i}>
                    {it.href ? (
                      <Link href={it.href} className="block transition hover:bg-paper-deep/40">{inner}</Link>
                    ) : (
                      inner
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {clear && (
        <div className="panel px-5 py-10 text-center text-sm text-ink-soft">
          Nothing missing, overdue, or short. The hub will flag issues here as they appear.
        </div>
      )}
    </div>
  );
}

function Tally({ n, label, sev }: { n: number; label: string; sev: Severity }) {
  const s = SEV[sev];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-1 text-xs", s.ring)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      <span className="font-semibold text-ink">{n}</span>
      <span className="text-ink-soft">{label}</span>
    </span>
  );
}
