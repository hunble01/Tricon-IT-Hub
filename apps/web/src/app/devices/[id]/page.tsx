"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MapPin, Pencil, Receipt, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, SectionCard, ErrorNote, deviceBadge } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

interface Assignment {
  id: string;
  assignedAt: string;
  returnedAt: string | null;
  notes: string | null;
  staff: { id: string; fullName: string } | null;
}
interface DeviceDetail {
  id: string;
  assetTag: string | null;
  serialNumber: string | null;
  type: string;
  model: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
  purchaseCost: string | null;
  purchaseDate: string | null;
  location: { id: string; name: string } | null;
  assignments: Assignment[];
}

interface Building { id: string; name: string }

export default function DeviceDetailPage() {
  const params = useParams<{ id: string }>();
  const [device, setDevice] = useState<DeviceDetail | null>(null);

  const refresh = useCallback(() => {
    if (!params.id) return;
    void api<DeviceDetail>(`/devices/${params.id}`).then(setDevice);
  }, [params.id]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <AppShell eyebrow="Inventory · Asset" title={device ? `${device.type}` : "Device"}>
      {() =>
        !device ? (
          <div className="panel px-5 py-12 text-center text-sm text-ink-soft">Loading…</div>
        ) : (
          <Detail device={device} onSaved={refresh} />
        )
      }
    </AppShell>
  );
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}
function duration(a: string, b: string | null): string {
  const start = new Date(a).getTime();
  const end = b ? new Date(b).getTime() : Date.now();
  const days = Math.max(0, Math.round((end - start) / 86400000));
  return days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
}

function Detail({ device, onSaved }: { device: DeviceDetail; onSaved: () => void }) {
  const badge = deviceBadge(device.status);
  const open = device.assignments.find((a) => !a.returnedAt);
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-5">
      <Link href="/devices" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft transition hover:text-ink">
        <ArrowLeft size={14} /> Back to inventory
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-lg font-semibold text-ink">{device.model ?? device.type}</span>
        <Pill tone={badge.tone} dot>{badge.label}</Pill>
        {device.assetTag && <span className="font-mono text-xs text-ink-soft">#{device.assetTag}</span>}
        {device.serialNumber && <span className="font-mono text-xs text-ink-faint">SN {device.serialNumber}</span>}
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-field border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-paper-deep"
        >
          {editing ? <X size={14} /> : <Pencil size={14} />}
          {editing ? "Close" : "Edit"}
        </button>
      </div>

      {editing && (
        <EditDeviceForm
          device={device}
          onSaved={() => { setEditing(false); onSaved(); }}
        />
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard title="Current status" bodyClassName="px-5 py-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Field label="Type" value={device.type} />
            <Field label="Held by" value={open?.staff?.fullName ?? "— in stock —"} />
            <Field label="Location" value={device.location?.name ?? "—"} icon={<MapPin size={12} />} />
            <Field label="Added" value={fmtDate(device.createdAt)} />
          </dl>
          {device.notes && (
            <p className="mt-4 whitespace-pre-wrap border-t border-line pt-3 text-xs text-ink-soft">{device.notes}</p>
          )}
        </SectionCard>

        <SectionCard title="Purchase provenance" bodyClassName="px-5 py-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Field
              label="Cost"
              value={device.purchaseCost != null ? `$${Number(device.purchaseCost).toFixed(2)}` : "—"}
              icon={<Receipt size={12} />}
            />
            <Field label="Purchased" value={fmtDate(device.purchaseDate)} />
          </dl>
          {device.purchaseCost == null && (
            <p className="mt-3 text-xs text-ink-faint">
              No purchase record yet. Add cost &amp; date by editing the device, or via Procurement
              (which also links the invoice line item).
            </p>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Custody trail" count={device.assignments.length}>
        {device.assignments.length === 0 ? (
          <p className="px-5 py-6 text-xs text-ink-soft">Never assigned — has stayed in stock.</p>
        ) : (
          <ol className="relative space-y-4 px-5 py-5 before:absolute before:left-[26px] before:top-7 before:h-[calc(100%-3rem)] before:w-px before:bg-line">
            {device.assignments.map((a) => (
              <li key={a.id} className="relative flex items-start gap-4">
                <span
                  className={`z-10 mt-0.5 flex h-3 w-3 shrink-0 rounded-full ring-4 ring-surface ${
                    a.returnedAt ? "bg-ink-faint" : "bg-accent"
                  }`}
                />
                <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3">
                  <div>
                    <span className="text-sm font-medium text-ink">{a.staff?.fullName ?? "Unknown"}</span>
                    {!a.returnedAt && <Pill tone="accent" className="ml-2">current</Pill>}
                    {a.notes && <div className="text-[11px] text-ink-faint">{a.notes}</div>}
                  </div>
                  <div className="text-xs text-ink-faint">
                    {fmtDate(a.assignedAt)}
                    {a.returnedAt ? ` → ${fmtDate(a.returnedAt)}` : " → now"}
                    <span className="ml-1.5 text-line-strong">·</span> {duration(a.assignedAt, a.returnedAt)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
    </div>
  );
}

const STATUS_OPTIONS = [
  "IN_STOCK", "ASSIGNED", "RETURNED", "IN_REPAIR", "RETIRED", "MISSING", "MISPLACED", "OFFSITE",
];

function EditDeviceForm({ device, onSaved }: { device: DeviceDetail; onSaved: () => void }) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [model, setModel] = useState(device.model ?? "");
  const [assetTag, setAssetTag] = useState(device.assetTag ?? "");
  const [serialNumber, setSerialNumber] = useState(device.serialNumber ?? "");
  const [status, setStatus] = useState(device.status);
  const [locationId, setLocationId] = useState(device.location?.id ?? "");
  const [purchaseCost, setPurchaseCost] = useState(device.purchaseCost != null ? String(device.purchaseCost) : "");
  const [purchaseDate, setPurchaseDate] = useState(device.purchaseDate ? device.purchaseDate.slice(0, 10) : "");
  const [notes, setNotes] = useState(device.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Building[]>("/buildings").then(setBuildings).catch(() => setBuildings([]));
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/devices/${device.id}`, {
        method: "PATCH",
        body: {
          model: model.trim() || null,
          assetTag: assetTag.trim() || undefined,
          serialNumber: serialNumber.trim() || undefined,
          status,
          locationId: locationId || null,
          purchaseCost: purchaseCost.trim() === "" ? null : Number(purchaseCost),
          purchaseDate: purchaseDate || null,
          notes: notes.trim() || undefined,
        },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Edit device" bodyClassName="space-y-3 px-5 py-4">
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LabeledField label="Model">
          <input value={model} onChange={(e) => setModel(e.target.value)} className="field w-full" placeholder="e.g. Latitude 5450" />
        </LabeledField>
        <LabeledField label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="field w-full">
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}
          </select>
        </LabeledField>
        <LabeledField label="Asset tag">
          <input value={assetTag} onChange={(e) => setAssetTag(e.target.value)} className="field w-full" />
        </LabeledField>
        <LabeledField label="Serial number">
          <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className="field w-full" />
        </LabeledField>
        <LabeledField label="Location">
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="field w-full">
            <option value="">— none —</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </LabeledField>
        <LabeledField label="Purchase cost ($)">
          <input type="number" min="0" step="0.01" value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} className="field w-full" />
        </LabeledField>
        <LabeledField label="Purchase date">
          <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="field w-full" />
        </LabeledField>
      </div>
      <LabeledField label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="field w-full resize-none" />
      </LabeledField>
      <div className="flex justify-end">
        <button type="button" disabled={busy} onClick={save} className="btn-primary">
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </SectionCard>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

function Field({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}
