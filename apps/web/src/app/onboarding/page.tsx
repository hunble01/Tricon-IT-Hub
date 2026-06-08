"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Package, Sparkles, Zap, X, ShoppingCart } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, ErrorNote, onboardingDeviceBadge } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type DeviceStatus = "PENDING" | "ALREADY_SET_UP" | "DONE";

interface Building { id: string; name: string }
interface Role { id: string; title: string }
interface RecommendedDevice { type: string; quantity: number }
interface OnboardingStaff {
  id: string;
  fullName: string;
  adPrefix: string | null;
  role: Role | null;
  building: Building | null;
}
interface Onboarding {
  id: string;
  staffId: string;
  startDate: string | null;
  monthLabel: string | null;
  adDone: boolean;
  badgeDone: boolean;
  hardwareDone: boolean;
  softwareDone: boolean;
  deviceStatus: DeviceStatus;
  assignedTech: string | null;
  notes: string | null;
  recommendedDevices: RecommendedDevice[];
  staff: OnboardingStaff;
  stockSource: Building | null;
}
interface BoardGroup { label: string; items: Onboarding[] }
interface StockDevice {
  id: string;
  assetTag: string | null;
  serialNumber: string | null;
  type: string;
  model: string | null;
  location: Building | null;
}
interface StockGroup { type: string; candidates: StockDevice[] }

interface ProvisionResult {
  assigned: Array<{ type: string; assigned: number; assetTags: string[] }>;
  shortfalls: Array<{ type: string; needed: number; assigned: number }>;
  totalAssigned: number;
  fullyProvisioned: boolean;
}
interface BatchResult {
  onboardingsProcessed: number;
  devicesAssigned: number;
  fullyProvisioned: number;
  partial: number;
  shortByType: Record<string, number>;
}

/** Recommended lists come as objects or bare strings — normalize both. */
function normalizeRec(raw: unknown): Array<{ type: string; quantity: number }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) =>
      typeof d === "string"
        ? { type: d, quantity: 1 }
        : { type: (d as { type?: string }).type ?? "", quantity: (d as { quantity?: number }).quantity ?? 1 },
    )
    .filter((d) => d.type.length > 0);
}

export default function OnboardingPage() {
  return (
    <AppShell eyebrow="Pipeline" title="Onboarding">
      {() => <OnboardingBoard />}
    </AppShell>
  );
}

function OnboardingBoard() {
  const [groups, setGroups] = useState<BoardGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batching, setBatching] = useState(false);
  const [batch, setBatch] = useState<BatchResult | null>(null);

  async function refresh() {
    setError(null);
    try {
      setGroups(await api<BoardGroup[]>("/onboarding"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load board");
    } finally {
      setLoading(false);
    }
  }

  async function provisionAll() {
    setBatching(true);
    setError(null);
    try {
      const res = await api<BatchResult>("/onboarding/auto-provision-all", { method: "POST", body: {} });
      setBatch(res);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Auto-provision failed");
    } finally {
      setBatching(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-soft">
            <span className="numeral mr-1 text-lg font-semibold text-ink">{total}</span> onboardings in flight
          </p>
          <button onClick={provisionAll} disabled={batching} className="btn-primary px-3 py-1.5 text-xs">
            <Zap size={14} />
            {batching ? "Provisioning…" : "Auto-provision all pending"}
          </button>
        </div>
        {batch && <BatchBanner batch={batch} onDismiss={() => setBatch(null)} />}
        {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
        {loading ? (
          <div className="panel px-5 py-12 text-center text-sm text-ink-soft">Loading…</div>
        ) : groups.length === 0 ? (
          <div className="panel px-5 py-16 text-center text-sm text-ink-soft">
            No onboardings yet. Start one on the right.
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-3">
            {groups.map((g, i) => (
              <MonthColumn key={g.label} group={g} index={i} onChange={refresh} />
            ))}
          </div>
        )}
      </div>
      <StartOnboardingPanel onStarted={refresh} />
    </div>
  );
}

function BatchBanner({ batch, onDismiss }: { batch: BatchResult; onDismiss: () => void }) {
  const shorts = Object.entries(batch.shortByType).sort((a, b) => b[1] - a[1]);
  return (
    <div className="animate-rise mb-4 overflow-hidden rounded-card border border-accent/20 bg-accent-wash shadow-soft">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white">
          <Zap size={16} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-accent-ink">
            Auto-provisioned {batch.devicesAssigned} device{batch.devicesAssigned === 1 ? "" : "s"} across{" "}
            {batch.onboardingsProcessed} onboarding{batch.onboardingsProcessed === 1 ? "" : "s"}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {batch.fullyProvisioned} fully equipped · {batch.partial} partially · the rest need stock.
          </p>
          {shorts.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <ShoppingCart size={13} className="text-honey" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">To order:</span>
              {shorts.map(([type, n]) => (
                <span key={type} className="rounded-full border border-honey/30 bg-honey-wash px-2 py-0.5 text-[11px] font-medium text-honey">
                  {n}× {type.toLowerCase().replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}
        </div>
        <button onClick={onDismiss} className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint hover:bg-surface-raised hover:text-ink">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function MonthColumn({ group, index, onChange }: { group: BoardGroup; index: number; onChange: () => void }) {
  return (
    <div className="stagger w-[310px] shrink-0" style={{ ["--i" as string]: index }}>
      <div className="mb-2.5 flex items-center justify-between px-1">
        <h2 className="font-display text-sm font-semibold text-ink">{group.label}</h2>
        <span className="rounded-full bg-paper-deep px-2 py-0.5 font-mono text-[10px] text-ink-soft">
          {group.items.length}
        </span>
      </div>
      <div className="space-y-3">
        {group.items.map((o) => (
          <OnboardingCard key={o.id} onboarding={o} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}

const CHECKLIST: Array<{ key: "adDone" | "badgeDone" | "hardwareDone" | "softwareDone"; label: string }> = [
  { key: "adDone", label: "AD account" },
  { key: "badgeDone", label: "Badge / access" },
  { key: "hardwareDone", label: "Hardware" },
  { key: "softwareDone", label: "Software" },
];

function OnboardingCard({ onboarding, onChange }: { onboarding: Onboarding; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provision, setProvision] = useState<ProvisionResult | null>(null);
  const o = onboarding;
  const done = CHECKLIST.filter((c) => o[c.key]).length;
  const badge = onboardingDeviceBadge(o.deviceStatus);

  async function autoProvision() {
    setProvisioning(true);
    setError(null);
    try {
      const r = await api<ProvisionResult>(`/onboarding/${o.id}/auto-provision`, { method: "POST", body: {} });
      setProvision(r);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Auto-provision failed");
    } finally {
      setProvisioning(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`/onboarding/${o.id}`, { method: "PATCH", body });
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  const recommended = normalizeRec(o.recommendedDevices);

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
          {o.staff.adPrefix && (
            <div className="mt-0.5 font-mono text-[11px] text-ink-faint">{o.staff.adPrefix}</div>
          )}
        </div>
        <Pill tone={badge.tone} dot>{badge.label}</Pill>
      </div>

      {/* Checklist progress */}
      <div className="mt-3.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">Checklist</span>
          <span className="font-mono text-[10px] text-ink-soft">{done}/4</span>
        </div>
        <div className="mb-2.5 flex gap-1">
          {CHECKLIST.map((c) => (
            <span
              key={c.key}
              className={cn("h-1 flex-1 rounded-full transition", o[c.key] ? "bg-accent" : "bg-line")}
            />
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
                o[c.key]
                  ? "border-accent/20 bg-accent-wash text-accent-ink"
                  : "border-line text-ink-soft hover:border-line-strong",
              )}
            >
              <span
                className={cn(
                  "flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border transition",
                  o[c.key] ? "border-accent bg-accent text-white" : "border-line-strong",
                )}
              >
                {o[c.key] && <Check size={10} strokeWidth={3} />}
              </span>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {recommended.length > 0 && (
        <div className="mt-3 flex items-start gap-1.5 text-[11px] text-ink-soft">
          <Package size={13} className="mt-px shrink-0 text-ink-faint" />
          <span>{recommended.map((d) => `${d.quantity}× ${d.type}`).join(", ")}</span>
        </div>
      )}
      {o.assignedTech && (
        <div className="mt-1.5 text-[11px] text-ink-soft">
          Tech: <span className="text-ink">{o.assignedTech}</span>
        </div>
      )}

      {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}

      <div className="mt-3.5 space-y-2">
        {o.deviceStatus !== "DONE" && recommended.length > 0 && (
          <button onClick={autoProvision} disabled={provisioning} className="btn-primary w-full px-2.5 py-1.5 text-xs">
            <Zap size={13} />
            {provisioning ? "Provisioning…" : "Auto-provision from stock"}
          </button>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPicking((p) => !p)}
            disabled={o.deviceStatus === "DONE"}
            className="btn-soft flex-1 px-2.5 py-1.5 text-xs disabled:opacity-50"
          >
            <Sparkles size={13} />
            {o.deviceStatus === "DONE" ? "Devices assigned" : picking ? "Close" : "Pick manually"}
          </button>
          {o.deviceStatus !== "DONE" && (
            <select
              value={o.deviceStatus}
              disabled={busy}
              onChange={(e) => patch({ deviceStatus: e.target.value })}
              className="field-sm"
            >
              <option value="PENDING">Pending</option>
              <option value="ALREADY_SET_UP">Already set up</option>
            </select>
          )}
        </div>
      </div>

      {provision && (
        <div className="mt-2 rounded-field border border-line bg-paper-deep/40 px-2.5 py-2 text-[11px]">
          {provision.fullyProvisioned ? (
            <span className="flex items-center gap-1.5 text-accent">
              <Check size={12} strokeWidth={3} /> Fully equipped from stock.
            </span>
          ) : (
            <div className="space-y-1">
              {provision.totalAssigned > 0 && (
                <span className="flex items-center gap-1.5 text-accent">
                  <Check size={12} strokeWidth={3} /> Assigned {provision.totalAssigned} from stock.
                </span>
              )}
              {provision.shortfalls.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-honey">
                  <ShoppingCart size={11} /> Order:
                  {provision.shortfalls.map((s) => (
                    <span key={s.type} className="font-medium">
                      {s.needed - s.assigned}× {s.type.toLowerCase().replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {picking && (
        <StockPicker
          onboardingId={o.id}
          onAssigned={() => {
            setPicking(false);
            onChange();
          }}
        />
      )}
    </div>
  );
}

function StockPicker({ onboardingId, onAssigned }: { onboardingId: string; onAssigned: () => void }) {
  const [groups, setGroups] = useState<StockGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api<StockGroup[]>(`/onboarding/${onboardingId}/stock-suggestions`)
      .then((g) => { if (active) setGroups(g); })
      .catch((err) => { if (active) setError(err instanceof ApiError ? err.message : "Failed to load stock"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onboardingId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function assign() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/onboarding/${onboardingId}/assign-devices`, {
        method: "POST",
        body: { assignments: [...selected].map((deviceId) => ({ deviceId })) },
      });
      onAssigned();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-field border border-line bg-paper-deep/40 p-3">
      {loading ? (
        <div className="text-xs text-ink-soft">Finding stock…</div>
      ) : groups.every((g) => g.candidates.length === 0) ? (
        <div className="text-xs text-ink-soft">No matching in-stock devices found.</div>
      ) : (
        <div className="space-y-2.5">
          {groups.map((g) => (
            <div key={g.type}>
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{g.type}</div>
              {g.candidates.length === 0 ? (
                <div className="pl-1 text-[11px] text-ink-faint">none in stock</div>
              ) : (
                <div className="mt-1 space-y-1">
                  {g.candidates.map((d) => (
                    <label
                      key={d.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[11px] hover:bg-surface-raised"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(d.id)}
                        onChange={() => toggle(d.id)}
                        className="h-3.5 w-3.5 accent-accent"
                      />
                      <span className="font-mono text-ink">{d.assetTag ?? d.serialNumber ?? d.id.slice(0, 8)}</span>
                      <span className="text-ink-faint">
                        {d.model ?? "—"}{d.location ? ` · ${d.location.name}` : ""}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}
      <button onClick={assign} disabled={busy || selected.size === 0} className="btn-primary mt-2.5 w-full py-1.5 text-xs">
        {busy ? "Assigning…" : `Assign ${selected.size} device${selected.size === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

function StartOnboardingPanel({ onStarted }: { onStarted: () => void }) {
  const [fullName, setFullName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [stockSourceId, setStockSourceId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [assignedTech, setAssignedTech] = useState("");
  const [notes, setNotes] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Role[]>("/roles").then(setRoles).catch(() => setRoles([]));
    api<Building[]>("/buildings").then(setBuildings).catch(() => setBuildings([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/onboarding", {
        method: "POST",
        body: {
          fullName,
          roleId,
          buildingId,
          stockSourceId: stockSourceId || undefined,
          startDate: startDate ? new Date(startDate).toISOString() : undefined,
          assignedTech: assignedTech || undefined,
          notes: notes || undefined,
        },
      });
      setFullName(""); setRoleId(""); setBuildingId(""); setStockSourceId("");
      setStartDate(""); setAssignedTech(""); setNotes("");
      onStarted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start onboarding");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel h-fit p-5">
      <h2 className="text-[15px] font-semibold text-ink">Start onboarding</h2>
      <p className="mt-1 text-xs text-ink-soft">
        Creates a staff record and pulls the role&apos;s recommended device list.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3.5 text-sm">
        <label className="block text-[13px] font-medium text-ink-soft">
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required className="field mt-1.5" />
        </label>
        <label className="block text-[13px] font-medium text-ink-soft">
          Role
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} required className="field mt-1.5">
            <option value="">—</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
        </label>
        <label className="block text-[13px] font-medium text-ink-soft">
          Building
          <select value={buildingId} onChange={(e) => setBuildingId(e.target.value)} required className="field mt-1.5">
            <option value="">—</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="block text-[13px] font-medium text-ink-soft">
          Stock source
          <select value={stockSourceId} onChange={(e) => setStockSourceId(e.target.value)} className="field mt-1.5">
            <option value="">Any location</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[13px] font-medium text-ink-soft">
            Start date
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="field mt-1.5" />
          </label>
          <label className="block text-[13px] font-medium text-ink-soft">
            Tech
            <input value={assignedTech} onChange={(e) => setAssignedTech(e.target.value)} className="field mt-1.5" />
          </label>
        </div>
        <label className="block text-[13px] font-medium text-ink-soft">
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="field mt-1.5" />
        </label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="submit" disabled={busy || !fullName.trim() || !roleId || !buildingId} className="btn-primary w-full">
          {busy ? "Starting…" : "Start onboarding"}
        </button>
      </form>
    </section>
  );
}
