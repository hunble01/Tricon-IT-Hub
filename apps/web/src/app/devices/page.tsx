"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, SectionCard, EmptyState, ErrorNote, deviceBadge } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

const DEVICE_TYPES = [
  "LAPTOP", "SURFACE", "PHONE", "TABLET", "HEADSET",
  "DOCK", "MONITOR", "MINI_PC", "USB_ADAPTER", "OTHER",
] as const;
const STATUSES = ["IN_STOCK", "ASSIGNED", "RETURNED", "IN_REPAIR", "RETIRED"] as const;

interface Building { id: string; name: string }
interface Staff { id: string; fullName: string }
interface Device {
  id: string;
  assetTag: string | null;
  serialNumber: string | null;
  type: string;
  model: string | null;
  status: typeof STATUSES[number];
  notes: string | null;
  location: Building | null;
  assignments: Array<{
    id: string;
    assignedAt: string;
    returnedAt: string | null;
    staff: { id: string; fullName: string };
  }>;
}

export default function DevicesPage() {
  return (
    <AppShell eyebrow="Inventory" title="Devices">
      {() => (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          <DeviceList />
          <NewDevicePanel />
        </div>
      )}
    </AppShell>
  );
}

function DeviceList() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignStaff, setAssignStaff] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Building[]>("/buildings").then(setBuildings);
    api<Staff[]>("/staff").then(setStaffList);
  }, []);

  useEffect(() => { void refresh(); }, [filterType, filterStatus, filterLocation, q]);

  async function refresh() {
    const params = new URLSearchParams();
    if (filterType) params.set("type", filterType);
    if (filterStatus) params.set("status", filterStatus);
    if (filterLocation) params.set("locationId", filterLocation);
    if (q) params.set("q", q);
    const qs = params.toString();
    const rows = await api<Device[]>(`/devices${qs ? `?${qs}` : ""}`);
    setDevices(rows);
  }

  async function doAssign(deviceId: string) {
    if (!assignStaff) return;
    setBusyId(deviceId);
    setError(null);
    try {
      await api(`/devices/${deviceId}/assign`, { method: "POST", body: { staffId: assignStaff } });
      setAssigningId(null);
      setAssignStaff("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Assign failed");
    } finally {
      setBusyId(null);
    }
  }

  async function doReturn(deviceId: string) {
    setBusyId(deviceId);
    setError(null);
    try {
      await api(`/devices/${deviceId}/return`, { method: "POST", body: {} });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Return failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SectionCard
      title="Inventory"
      count={devices.length}
      actions={
        <>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="field-sm w-36 pl-7" />
          </div>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="field-sm">
            <option value="">All types</option>
            {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="field-sm">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)} className="field-sm">
            <option value="">All locations</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </>
      }
    >
      {error && <div className="px-5 pt-3"><ErrorNote>{error}</ErrorNote></div>}
      {devices.length === 0 ? (
        <EmptyState title="No devices match these filters" hint="Adjust the filters, or add a device on the right." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {["Type / model", "Tags", "Status", "Location", "Assigned to", ""].map((h, idx) => (
                <th key={idx} className="px-5 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-ink-faint">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const open = d.assignments.find((a) => !a.returnedAt);
              const badge = deviceBadge(d.status);
              return (
                <tr key={d.id} className="border-b border-line/70 transition last:border-0 hover:bg-paper-deep/40">
                  <td className="px-5 py-3">
                    <Link href={`/devices/${d.id}`} className="font-medium text-ink decoration-accent/40 underline-offset-2 hover:underline">
                      {d.type}
                    </Link>
                    <div className="text-xs text-ink-faint">{d.model ?? "—"}</div>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-ink-soft">
                    {d.assetTag && <div>#{d.assetTag}</div>}
                    {d.serialNumber && <div className="text-ink-faint">SN {d.serialNumber}</div>}
                    {!d.assetTag && !d.serialNumber && "—"}
                  </td>
                  <td className="px-5 py-3"><Pill tone={badge.tone} dot>{badge.label}</Pill></td>
                  <td className="px-5 py-3 text-ink-soft">{d.location?.name ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-soft">{open ? open.staff.fullName : "—"}</td>
                  <td className="px-5 py-3 text-right">
                    {open ? (
                      <button onClick={() => doReturn(d.id)} disabled={busyId === d.id} className="btn-ghost px-2.5 py-1 text-xs">
                        {busyId === d.id ? "…" : "Return"}
                      </button>
                    ) : assigningId === d.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <select value={assignStaff} onChange={(e) => setAssignStaff(e.target.value)} className="field-sm">
                          <option value="">staff…</option>
                          {staffList.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                        </select>
                        <button onClick={() => doAssign(d.id)} className="btn-primary px-2.5 py-1 text-xs">OK</button>
                        <button onClick={() => setAssigningId(null)} className="btn-ghost px-2 py-1 text-xs">×</button>
                      </div>
                    ) : (
                      <button onClick={() => setAssigningId(d.id)} disabled={d.status === "RETIRED"} className="btn-ghost px-2.5 py-1 text-xs">
                        Assign
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function NewDevicePanel() {
  const [type, setType] = useState<string>("LAPTOP");
  const [assetTag, setAssetTag] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [model, setModel] = useState("");
  const [locationId, setLocationId] = useState("");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Building[]>("/buildings").then(setBuildings);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/devices", {
        method: "POST",
        body: {
          type,
          assetTag: assetTag || undefined,
          serialNumber: serialNumber || undefined,
          model: model || undefined,
          locationId: locationId || undefined,
        },
      });
      setAssetTag(""); setSerialNumber(""); setModel(""); setLocationId("");
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed");
    } finally { setBusy(false); }
  }

  return (
    <section className="panel h-fit p-5">
      <h2 className="text-[15px] font-semibold text-ink">Add device</h2>
      <form onSubmit={submit} className="mt-4 space-y-3.5 text-sm">
        <label className="block text-[13px] font-medium text-ink-soft">
          Type
          <select value={type} onChange={(e) => setType(e.target.value)} className="field mt-1.5">
            {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block text-[13px] font-medium text-ink-soft">
          Asset tag
          <input value={assetTag} onChange={(e) => setAssetTag(e.target.value)} className="field mt-1.5" />
        </label>
        <label className="block text-[13px] font-medium text-ink-soft">
          Serial number
          <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className="field mt-1.5" />
        </label>
        <label className="block text-[13px] font-medium text-ink-soft">
          Model
          <input value={model} onChange={(e) => setModel(e.target.value)} className="field mt-1.5" />
        </label>
        <label className="block text-[13px] font-medium text-ink-soft">
          Stock location
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="field mt-1.5">
            <option value="">—</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Saving…" : "Create device"}
        </button>
      </form>
    </section>
  );
}
