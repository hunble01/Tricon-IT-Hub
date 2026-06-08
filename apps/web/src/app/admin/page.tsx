"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, SectionCard, type Tone } from "@/components/ui";
import { api } from "@/lib/api";

const DEVICE_TYPES = [
  "LAPTOP", "SURFACE", "PHONE", "TABLET", "HEADSET",
  "DOCK", "MONITOR", "MINI_PC", "USB_ADAPTER", "OTHER",
] as const;
type DeviceType = (typeof DEVICE_TYPES)[number];

interface Building {
  id: string;
  name: string;
  displayName: string | null;
  neighborhood: string | null;
  status: "LIVE" | "OPENING" | "COMING_SOON" | "CORPORATE";
}
interface RoleDeviceProfile {
  id: string;
  deviceType: DeviceType;
  quantity: number;
}
interface Role {
  id: string;
  title: string;
  category: "BUILDING_STAFF" | "MANAGER" | "CORPORATE";
  isSharedDevice: boolean;
  deviceProfile: RoleDeviceProfile[];
}

export default function AdminPage() {
  return (
    <AppShell eyebrow="Configuration" title="Admin">
      {(user) => (
        <div className="space-y-5">
          <p className="text-sm text-ink-soft">Reference data — buildings, roles, and the role → device matrix.</p>
          <BuildingsSection canEdit={user.role === "ADMIN"} />
          <RolesSection canEdit={user.role === "ADMIN"} />
        </div>
      )}
    </AppShell>
  );
}

function buildingTone(status: Building["status"]): { tone: Tone; label: string } {
  const map: Record<Building["status"], { tone: Tone; label: string }> = {
    LIVE: { tone: "success", label: "Live" },
    OPENING: { tone: "warn", label: "Opening" },
    COMING_SOON: { tone: "info", label: "Coming soon" },
    CORPORATE: { tone: "neutral", label: "Corporate" },
  };
  return map[status];
}

function BuildingsSection({ canEdit }: { canEdit: boolean }) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Building[]>("/buildings").then((b) => {
      setBuildings(b);
      setLoading(false);
    });
  }, []);

  return (
    <SectionCard title="Buildings" count={buildings.length}>
      {loading ? (
        <div className="px-5 py-6 text-sm text-ink-soft">Loading…</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {["Name", "Display name", "Neighborhood", "Status"].map((h) => (
                <th key={h} className="px-5 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-ink-faint">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buildings.map((b) => {
              const badge = buildingTone(b.status);
              return (
                <tr key={b.id} className="border-b border-line/70 transition last:border-0 hover:bg-paper-deep/40">
                  <td className="px-5 py-3 font-medium text-ink">{b.name}</td>
                  <td className="px-5 py-3 text-ink-soft">{b.displayName ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-soft">{b.neighborhood ?? "—"}</td>
                  <td className="px-5 py-3"><Pill tone={badge.tone} dot>{badge.label}</Pill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!canEdit && (
        <p className="border-t border-line px-5 py-2.5 text-xs text-ink-faint">
          You need the ADMIN role to add or edit buildings.
        </p>
      )}
    </SectionCard>
  );
}

function RolesSection({ canEdit }: { canEdit: boolean }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<DeviceType, number>>(emptyDraft());

  useEffect(() => { void load(); }, []);

  async function load() {
    const r = await api<Role[]>("/roles");
    setRoles(r);
    setLoading(false);
  }

  function startEdit(role: Role) {
    const next = emptyDraft();
    for (const d of role.deviceProfile) next[d.deviceType] = d.quantity;
    setDraft(next);
    setEditingId(role.id);
  }

  async function save(roleId: string) {
    const devices = (Object.entries(draft) as [DeviceType, number][])
      .filter(([, qty]) => qty > 0)
      .map(([deviceType, quantity]) => ({ deviceType, quantity }));
    await api(`/roles/${roleId}/devices`, { method: "PUT", body: { devices } });
    setEditingId(null);
    await load();
  }

  return (
    <SectionCard title="Roles & device matrix" count={roles.length}>
      {loading ? (
        <div className="px-5 py-6 text-sm text-ink-soft">Loading…</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {["Title", "Category", "Shared", "Devices", canEdit ? "" : null].filter((h) => h !== null).map((h, i) => (
                <th key={i} className="px-5 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-ink-faint">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id} className="border-b border-line/70 align-top transition last:border-0 hover:bg-paper-deep/40">
                <td className="px-5 py-3 font-medium text-ink">{r.title}</td>
                <td className="px-5 py-3 text-ink-soft">{r.category.toLowerCase().replace(/_/g, " ")}</td>
                <td className="px-5 py-3 text-ink-soft">{r.isSharedDevice ? "yes" : "no"}</td>
                <td className="px-5 py-3">
                  {editingId === r.id ? (
                    <DeviceMatrixEditor draft={draft} setDraft={setDraft} />
                  ) : (
                    <DeviceList items={r.deviceProfile} />
                  )}
                </td>
                {canEdit && (
                  <td className="px-5 py-3 text-right">
                    {editingId === r.id ? (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => save(r.id)} className="btn-primary px-2.5 py-1 text-xs">Save</button>
                        <button onClick={() => setEditingId(null)} className="btn-ghost px-2.5 py-1 text-xs">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(r)} className="btn-ghost px-2.5 py-1 text-xs">
                        <Pencil size={12} /> Edit
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function emptyDraft(): Record<DeviceType, number> {
  return Object.fromEntries(DEVICE_TYPES.map((t) => [t, 0])) as Record<DeviceType, number>;
}

function DeviceList({ items }: { items: RoleDeviceProfile[] }) {
  if (items.length === 0) return <span className="text-xs text-ink-faint">— none —</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((d) => (
        <span key={d.id} className="rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">
          {d.deviceType.replace(/_/g, " ").toLowerCase()}
          {d.quantity > 1 ? ` ×${d.quantity}` : ""}
        </span>
      ))}
    </div>
  );
}

function DeviceMatrixEditor({
  draft,
  setDraft,
}: {
  draft: Record<DeviceType, number>;
  setDraft: (d: Record<DeviceType, number>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
      {DEVICE_TYPES.map((t) => (
        <label key={t} className="flex items-center gap-1.5 text-[11px]">
          <input
            type="number"
            min={0}
            value={draft[t]}
            onChange={(e) => setDraft({ ...draft, [t]: Math.max(0, Number(e.target.value) || 0) })}
            className="w-12 rounded-[6px] border border-line bg-surface-raised px-1.5 py-0.5 text-center outline-none focus:border-accent-bright"
          />
          <span className="truncate text-ink-soft">{t.toLowerCase().replace(/_/g, " ")}</span>
        </label>
      ))}
    </div>
  );
}
