"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck, Check, MapPinOff, PackageX } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, SectionCard, ErrorNote, EmptyState } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Building { id: string; name: string }
interface ExpectedDevice {
  id: string;
  type: string;
  model: string | null;
  assetTag: string | null;
  serialNumber: string | null;
  status: string;
}
interface ActiveAudit {
  id: string;
  buildingId: string;
  buildingName: string | null;
  completedAt: string | null;
  expected: ExpectedDevice[];
}
interface AuditSummary { total: number; found: number; missing: number; misplaced: number }
interface AuditListItem {
  id: string;
  buildingName: string | null;
  startedAt: string;
  completedAt: string | null;
  entryCount: number;
}

type Mark = "FOUND" | "MISPLACED" | "MISSING";

export default function AuditPage() {
  return (
    <AppShell eyebrow="Inventory" title="Site Audit">
      {() => <AuditWorkspace />}
    </AppShell>
  );
}

function AuditWorkspace() {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [recent, setRecent] = useState<AuditListItem[]>([]);
  const [active, setActive] = useState<ActiveAudit | null>(null);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadRecent() {
    setRecent(await api<AuditListItem[]>("/site-audits"));
  }
  useEffect(() => {
    api<Building[]>("/buildings").then(setBuildings).catch(() => {});
    void loadRecent();
  }, []);

  async function start(buildingId: string) {
    if (!buildingId) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const a = await api<ActiveAudit>("/site-audits", { method: "POST", body: { buildingId } });
      setActive(a);
      setMarks(Object.fromEntries(a.expected.map((d) => [d.id, "FOUND" as Mark])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start audit");
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const a = await api<ActiveAudit>(`/site-audits/${id}`);
      setActive(a);
      setMarks(Object.fromEntries(a.expected.map((d) => [d.id, "FOUND" as Mark])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load audit");
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const entries = active.expected.map((d) => {
        const m = marks[d.id] ?? "FOUND";
        return {
          deviceId: d.id,
          found: m !== "MISSING",
          resultStatus: m === "MISPLACED" ? "MISPLACED" : undefined,
        };
      });
      const res = await api<ActiveAudit & { summary: AuditSummary }>(`/site-audits/${active.id}/complete`, {
        method: "POST",
        body: { entries },
      });
      setSummary(res.summary);
      setActive(null);
      setMarks({});
      await loadRecent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to complete audit");
    } finally {
      setBusy(false);
    }
  }

  const counts = active
    ? active.expected.reduce(
        (acc, d) => {
          const m = marks[d.id] ?? "FOUND";
          acc[m]++;
          return acc;
        },
        { FOUND: 0, MISPLACED: 0, MISSING: 0 } as Record<Mark, number>,
      )
    : null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        {error && <ErrorNote>{error}</ErrorNote>}

        {summary && (
          <div className="animate-rise rounded-card border border-accent/20 bg-accent-wash p-5">
            <h2 className="font-display text-xl font-semibold text-accent-ink">Audit complete</h2>
            <p className="mt-1 text-sm text-ink-soft">Records reconciled against what&apos;s physically on site.</p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <Stat n={summary.found} label="found" tone="text-accent" />
              <Stat n={summary.misplaced} label="misplaced" tone="text-honey" />
              <Stat n={summary.missing} label="missing" tone="text-clay" />
            </div>
          </div>
        )}

        {active ? (
          <SectionCard
            title={`Auditing · ${active.buildingName ?? "site"}`}
            count={active.expected.length}
            actions={
              counts && (
                <div className="flex items-center gap-2 text-[11px]">
                  <Pill tone="success">{counts.FOUND} found</Pill>
                  {counts.MISPLACED > 0 && <Pill tone="warn">{counts.MISPLACED} misplaced</Pill>}
                  {counts.MISSING > 0 && <Pill tone="danger">{counts.MISSING} missing</Pill>}
                </div>
              )
            }
          >
            {active.expected.length === 0 ? (
              <EmptyState
                icon={<ClipboardCheck size={18} />}
                title="No devices recorded at this site"
                hint="Records show nothing here to reconcile."
              />
            ) : (
              <>
                <div className="divide-y divide-line">
                  {active.expected.map((d) => (
                    <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div>
                        <div className="text-sm font-medium text-ink">
                          {d.type} <span className="font-normal text-ink-soft">{d.model ?? ""}</span>
                        </div>
                        <div className="font-mono text-[11px] text-ink-faint">
                          {d.assetTag ? `#${d.assetTag}` : d.serialNumber ? `SN ${d.serialNumber}` : d.id.slice(0, 8)}
                        </div>
                      </div>
                      <Segmented value={marks[d.id] ?? "FOUND"} onChange={(m) => setMarks((s) => ({ ...s, [d.id]: m }))} />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
                  <button onClick={() => { setActive(null); setMarks({}); }} className="btn-ghost px-3 py-1.5 text-xs">
                    Cancel
                  </button>
                  <button onClick={complete} disabled={busy} className="btn-primary px-3 py-1.5 text-xs">
                    {busy ? "Saving…" : "Complete audit"}
                  </button>
                </div>
              </>
            )}
          </SectionCard>
        ) : (
          !summary && (
            <SectionCard title="Site Audit">
              <EmptyState
                icon={<ClipboardCheck size={18} />}
                title="Reconcile a site against the records"
                hint="Pick a building on the right to start a walkaround. The app lists what should be there; you check off what's physically present."
              />
            </SectionCard>
          )
        )}
      </div>

      <div className="space-y-5">
        <section className="panel p-5">
          <h2 className="text-[15px] font-semibold text-ink">Start an audit</h2>
          <p className="mt-1 text-xs text-ink-soft">Pick a building to walk.</p>
          <div className="mt-3 space-y-2">
            {buildings.map((b) => (
              <button
                key={b.id}
                onClick={() => start(b.id)}
                disabled={busy}
                className="flex w-full items-center justify-between rounded-field border border-line bg-surface-raised px-3 py-2 text-sm text-ink transition hover:border-accent/40 hover:bg-accent-wash/40 disabled:opacity-50"
              >
                {b.name}
                <ClipboardCheck size={14} className="text-ink-faint" />
              </button>
            ))}
          </div>
        </section>

        <SectionCard title="Recent audits" count={recent.length}>
          {recent.length === 0 ? (
            <p className="px-5 py-6 text-xs text-ink-soft">No audits yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((a) => (
                <li key={a.id}>
                  <button onClick={() => open(a.id)} className="block w-full px-5 py-3 text-left transition hover:bg-paper-deep/40">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{a.buildingName ?? "—"}</span>
                      <Pill tone={a.completedAt ? "success" : "warn"}>{a.completedAt ? "done" : "open"}</Pill>
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-faint">
                      {new Date(a.startedAt).toLocaleDateString()} · {a.entryCount} checked
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={`numeral text-2xl font-semibold ${tone}`}>{n}</span>
      <span className="text-ink-soft">{label}</span>
    </span>
  );
}

function Segmented({ value, onChange }: { value: Mark; onChange: (m: Mark) => void }) {
  const opts: Array<{ m: Mark; label: string; icon: React.ReactNode; on: string }> = [
    { m: "FOUND", label: "Found", icon: <Check size={12} />, on: "bg-accent text-white" },
    { m: "MISPLACED", label: "Misplaced", icon: <MapPinOff size={12} />, on: "bg-honey text-white" },
    { m: "MISSING", label: "Missing", icon: <PackageX size={12} />, on: "bg-clay text-white" },
  ];
  return (
    <div className="flex overflow-hidden rounded-field border border-line">
      {opts.map((o) => (
        <button
          key={o.m}
          onClick={() => onChange(o.m)}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium transition",
            value === o.m ? o.on : "bg-surface-raised text-ink-soft hover:bg-paper-deep/50",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
