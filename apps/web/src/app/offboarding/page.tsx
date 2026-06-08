"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Package, X, PackageCheck, UserMinus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, ErrorNote, type Tone } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type Status = "PENDING" | "IN_PROGRESS" | "COMPLETED";

interface Building { id: string; name: string }
interface Role { id: string; title: string }
interface HeldDevice { id: string; device: { id: string; type: string; model: string | null; assetTag: string | null } }
interface OffboardStaff {
  id: string;
  fullName: string;
  role: Role | null;
  building: Building | null;
  devices: HeldDevice[];
}
interface Offboarding {
  id: string;
  staffId: string;
  lastDay: string | null;
  monthLabel: string | null;
  adDisabled: boolean;
  badgeReturned: boolean;
  hardwareReturned: boolean;
  accountsRevoked: boolean;
  status: Status;
  assignedTech: string | null;
  reason: string | null;
  notes: string | null;
  staff: OffboardStaff;
}
interface BoardGroup { label: string; items: Offboarding[] }
interface Candidate { id: string; fullName: string; role: Role | null; building: Building | null }
interface ReclaimResult { reclaimed: Array<{ deviceId: string; label: string; assetTag: string | null }>; count: number }

function statusBadge(value: Status): { tone: Tone; label: string } {
  const map: Record<Status, { tone: Tone; label: string }> = {
    PENDING: { tone: "warn", label: "Pending" },
    IN_PROGRESS: { tone: "info", label: "In progress" },
    COMPLETED: { tone: "success", label: "Completed" },
  };
  return map[value];
}

export default function OffboardingPage() {
  return (
    <AppShell eyebrow="Pipeline" title="Offboarding">
      {() => <OffboardingBoard />}
    </AppShell>
  );
}

function OffboardingBoard() {
  const [groups, setGroups] = useState<BoardGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setGroups(await api<BoardGroup[]>("/offboarding"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load board");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-soft">
            <span className="numeral mr-1 text-lg font-semibold text-ink">{total}</span> offboardings in flight
          </p>
        </div>
        {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
        {loading ? (
          <div className="panel px-5 py-12 text-center text-sm text-ink-soft">Loading…</div>
        ) : groups.length === 0 ? (
          <div className="panel px-5 py-16 text-center text-sm text-ink-soft">
            No offboardings yet. Start one on the right when someone is leaving.
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-3">
            {groups.map((g, i) => (
              <MonthColumn key={g.label} group={g} index={i} onChange={refresh} />
            ))}
          </div>
        )}
      </div>
      <StartOffboardingPanel onStarted={refresh} />
    </div>
  );
}

function MonthColumn({ group, index, onChange }: { group: BoardGroup; index: number; onChange: () => void }) {
  return (
    <div className="stagger w-[320px] shrink-0" style={{ ["--i" as string]: index }}>
      <div className="mb-2.5 flex items-center justify-between px-1">
        <h2 className="font-display text-sm font-semibold text-ink">{group.label}</h2>
        <span className="rounded-full bg-paper-deep px-2 py-0.5 font-mono text-[10px] text-ink-soft">
          {group.items.length}
        </span>
      </div>
      <div className="space-y-3">
        {group.items.map((o) => (
          <OffboardingCard key={o.id} offboarding={o} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}

const CHECKLIST: Array<{ key: "hardwareReturned" | "adDisabled" | "badgeReturned" | "accountsRevoked"; label: string }> = [
  { key: "hardwareReturned", label: "Hardware back" },
  { key: "adDisabled", label: "AD disabled" },
  { key: "badgeReturned", label: "Badge returned" },
  { key: "accountsRevoked", label: "Accounts revoked" },
];

function OffboardingCard({ offboarding, onChange }: { offboarding: Offboarding; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reclaiming, setReclaiming] = useState(false);
  const [reclaim, setReclaim] = useState<ReclaimResult | null>(null);
  const o = offboarding;
  const done = CHECKLIST.filter((c) => o[c.key]).length;
  const badge = statusBadge(o.status);
  const held = o.staff.devices ?? [];

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`/offboarding/${o.id}`, { method: "PATCH", body });
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function reclaimDevices() {
    setReclaiming(true);
    setError(null);
    try {
      const r = await api<ReclaimResult>(`/offboarding/${o.id}/reclaim`, { method: "POST", body: {} });
      setReclaim(r);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reclaim failed");
    } finally {
      setReclaiming(false);
    }
  }

  return (
    <div className="hover-lift panel-raised p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/staff/${o.staffId}`} className="text-sm font-semibold text-ink hover:underline">
            {o.staff.fullName}
          </Link>
          <div className="truncate text-xs text-ink-soft">
            {o.staff.role?.title ?? "—"} · {o.staff.building?.name ?? "—"}
          </div>
          {o.lastDay && (
            <div className="mt-0.5 font-mono text-[11px] text-ink-faint">
              Last day {new Date(o.lastDay).toLocaleDateString()}
            </div>
          )}
        </div>
        <Pill tone={badge.tone} dot>{badge.label}</Pill>
      </div>

      {/* Held devices (gear to reclaim) */}
      <div className="mt-3 rounded-field border border-line bg-paper-deep/40 px-2.5 py-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
            <Package size={12} /> Still holding
          </span>
          <span className="font-mono text-[10px] text-ink-soft">{held.length}</span>
        </div>
        {held.length === 0 ? (
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-accent">
            <Check size={12} strokeWidth={3} /> All gear returned.
          </div>
        ) : (
          <>
            <div className="mt-1.5 space-y-0.5">
              {held.slice(0, 5).map((h) => (
                <div key={h.id} className="flex items-center gap-1.5 text-[11px] text-ink-soft">
                  <span className="font-mono text-ink">{h.device.assetTag ?? h.device.id.slice(0, 8)}</span>
                  <span className="text-ink-faint">{h.device.type.toLowerCase().replace(/_/g, " ")}{h.device.model ? ` · ${h.device.model}` : ""}</span>
                </div>
              ))}
              {held.length > 5 && <div className="text-[11px] text-ink-faint">+{held.length - 5} more</div>}
            </div>
            <button onClick={reclaimDevices} disabled={reclaiming} className="btn-primary mt-2 w-full px-2.5 py-1.5 text-xs">
              <PackageCheck size={13} />
              {reclaiming ? "Reclaiming…" : `Reclaim all ${held.length} to stock`}
            </button>
          </>
        )}
      </div>

      {reclaim && reclaim.count > 0 && (
        <div className="mt-2 flex items-center gap-1.5 rounded-field border border-accent/20 bg-accent-wash px-2.5 py-1.5 text-[11px] text-accent">
          <Check size={12} strokeWidth={3} /> Reclaimed {reclaim.count} device{reclaim.count === 1 ? "" : "s"} to stock.
        </div>
      )}

      {/* Checklist */}
      <div className="mt-3.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">Checklist</span>
          <span className="font-mono text-[10px] text-ink-soft">{done}/4</span>
        </div>
        <div className="mb-2.5 flex gap-1">
          {CHECKLIST.map((c) => (
            <span key={c.key} className={cn("h-1 flex-1 rounded-full transition", o[c.key] ? "bg-accent" : "bg-line")} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {CHECKLIST.map((c) => (
            <button
              key={c.key}
              type="button"
              disabled={busy}
              onClick={() => patch({ [c.key]: !o[c.key] })}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-[11px] transition",
                o[c.key] ? "border-accent/20 bg-accent-wash text-accent-ink" : "border-line text-ink-soft hover:border-line-strong",
              )}
            >
              <span className={cn(
                "flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border transition",
                o[c.key] ? "border-accent bg-accent text-white" : "border-line-strong",
              )}>
                {o[c.key] && <Check size={10} strokeWidth={3} />}
              </span>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {o.reason && <div className="mt-2.5 text-[11px] text-ink-soft">Reason: <span className="text-ink">{o.reason}</span></div>}
      {o.assignedTech && <div className="mt-1 text-[11px] text-ink-soft">Tech: <span className="text-ink">{o.assignedTech}</span></div>}

      {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}

      {o.status !== "COMPLETED" && (
        <button
          onClick={() => patch({ status: "COMPLETED" })}
          disabled={busy}
          className="btn-soft mt-3 w-full px-2.5 py-1.5 text-xs"
        >
          <Check size={13} /> Mark complete &amp; depart
        </button>
      )}
    </div>
  );
}

function StartOffboardingPanel({ onStarted }: { onStarted: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [staffId, setStaffId] = useState("");
  const [lastDay, setLastDay] = useState("");
  const [assignedTech, setAssignedTech] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadCandidates() {
    try {
      setCandidates(await api<Candidate[]>("/offboarding/candidates"));
    } catch {
      setCandidates([]);
    }
  }

  useEffect(() => { void loadCandidates(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/offboarding", {
        method: "POST",
        body: {
          staffId,
          lastDay: lastDay ? new Date(lastDay).toISOString() : undefined,
          assignedTech: assignedTech || undefined,
          reason: reason || undefined,
          notes: notes || undefined,
        },
      });
      setStaffId(""); setLastDay(""); setAssignedTech(""); setReason(""); setNotes("");
      await loadCandidates();
      onStarted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start offboarding");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel h-fit p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <UserMinus size={16} className="text-ink-faint" /> Start offboarding
      </h2>
      <p className="mt-1 text-xs text-ink-soft">
        Pick a current staff member who&apos;s leaving. Reclaiming their gear returns it to stock.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3.5 text-sm">
        <label className="block text-[13px] font-medium text-ink-soft">
          Staff member
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)} required className="field mt-1.5">
            <option value="">—</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}{c.building ? ` · ${c.building.name}` : ""}
              </option>
            ))}
          </select>
        </label>
        {candidates.length === 0 && (
          <p className="text-[11px] text-ink-faint">No eligible staff (everyone active already has an offboarding).</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[13px] font-medium text-ink-soft">
            Last day
            <input type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} className="field mt-1.5" />
          </label>
          <label className="block text-[13px] font-medium text-ink-soft">
            Tech
            <input value={assignedTech} onChange={(e) => setAssignedTech(e.target.value)} className="field mt-1.5" />
          </label>
        </div>
        <label className="block text-[13px] font-medium text-ink-soft">
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Resignation, end of contract…" className="field mt-1.5" />
        </label>
        <label className="block text-[13px] font-medium text-ink-soft">
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="field mt-1.5" />
        </label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="submit" disabled={busy || !staffId} className="btn-primary w-full">
          {busy ? "Starting…" : "Start offboarding"}
        </button>
      </form>
    </section>
  );
}
