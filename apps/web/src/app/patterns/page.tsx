"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Radar, RefreshCw, AlertTriangle, Building2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, ErrorNote, EmptyState } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

interface Pattern {
  theme: string;
  suggestedRootCause: string;
  building: string | null;
  count: number;
  tickets: Array<{ id: string; subject: string; building: string | null }>;
}

export default function PatternsPage() {
  return (
    <AppShell eyebrow="Intelligence" title="Pattern Detection">
      {() => <Patterns />}
    </AppShell>
  );
}

function Patterns() {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [analyzed, setAnalyzed] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ patterns: Pattern[]; analyzed: number }>("/patterns");
      setPatterns(res.patterns);
      setAnalyzed(res.analyzed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to scan");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void scan(); }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          {analyzed != null ? (
            <>Scanned <span className="numeral font-semibold text-ink">{analyzed}</span> open tickets · found <span className="numeral font-semibold text-ink">{patterns.length}</span> likely pattern{patterns.length === 1 ? "" : "s"}</>
          ) : "Looking for systemic issues across open tickets…"}
        </p>
        <button type="button" onClick={scan} disabled={loading} className="btn-ghost">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Re-scan
        </button>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <div className="panel px-5 py-12 text-center text-sm text-ink-soft">Clustering tickets…</div>
      ) : patterns.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Radar size={20} />}
            title="No patterns detected"
            hint="Open tickets look like independent, one-off issues right now. Re-scan as new tickets arrive."
          />
        </div>
      ) : (
        <div className="space-y-4">
          {patterns.map((p, i) => (
            <div key={i} className="stagger panel p-5" style={{ ["--i" as string]: i }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-honey-wash text-honey">
                    <AlertTriangle size={18} />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-semibold text-ink">{p.theme}</h2>
                    <div className="mt-0.5 flex items-center gap-2">
                      <Pill tone="warn">{p.count} related tickets</Pill>
                      {p.building && (
                        <span className="flex items-center gap-1 text-xs text-ink-soft">
                          <Building2 size={12} /> {p.building}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-card border border-line bg-paper-deep/30 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">Likely root cause</p>
                <p className="mt-1 text-sm text-ink">{p.suggestedRootCause}</p>
              </div>

              <ul className="mt-3 space-y-1.5">
                {p.tickets.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/tickets/${t.id}`}
                      className="flex items-center gap-2 rounded-field px-2 py-1.5 text-sm text-ink-soft transition hover:bg-paper-deep/50 hover:text-ink"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-honey" />
                      {t.subject}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
