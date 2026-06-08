"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Wand2, Trash2, ArrowRight, Check } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, ErrorNote, type Tone } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const DEVICE_TYPES = [
  "LAPTOP", "SURFACE", "PHONE", "TABLET", "HEADSET",
  "DOCK", "MONITOR", "MINI_PC", "USB_ADAPTER", "OTHER",
] as const;

interface Role { id: string; title: string }
interface Building { id: string; name: string }

interface AnalyzeResult {
  kind: "NEW_HIRE" | "DEVICES" | "STAFF" | "UNKNOWN";
  source: "ai" | "basic";
  summary: string;
  newHires: Array<{
    fullName: string; roleTitle: string | null; roleId: string | null;
    buildingName: string | null; buildingId: string | null;
    startDate: string | null; adPrefix: string | null; unresolved: string[];
  }>;
  devices: Array<{
    type: string; model: string | null; serialNumber: string | null;
    assetTag: string | null; quantity: number;
  }>;
  staff: Array<{
    fullName: string; roleTitle: string | null; roleId: string | null;
    buildingName: string | null; buildingId: string | null;
    email: string | null; phone: string | null;
  }>;
}

type Hire = AnalyzeResult["newHires"][number] & { locationId?: string };
type Dev = AnalyzeResult["devices"][number] & { locationId?: string };
type Person = AnalyzeResult["staff"][number];

const SAMPLES: Record<string, { hint: string; text: string }> = {
  "New-hire email": {
    hint: "NEW_HIRE",
    text: `Hi IT — please set up our new leasing consultant.

Name: Priya Anand
Role: Leasing Consultant
Building: Birch House
Start date: 2026-06-22

Thanks!`,
  },
  "Device shipment": {
    hint: "DEVICES",
    text: `Order #DL-99421 received:
Dell Latitude 5450 laptop  S/N: 7QX2K93  asset: LAP-3310
2x Jabra Evolve2 65 headset
iPhone 15  serial: G99TLM2
Dell U2724 monitor x3`,
  },
};

export default function IntakePage() {
  return (
    <AppShell eyebrow="Automation" title="Smart Intake">
      {() => <IntakeConsole />}
    </AppShell>
  );
}

function IntakeConsole() {
  const [rawText, setRawText] = useState("");
  const [hint, setHint] = useState("AUTO");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);

  const [hires, setHires] = useState<Hire[]>([]);
  const [devs, setDevs] = useState<Dev[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  const [roles, setRoles] = useState<Role[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [committing, setCommitting] = useState(false);
  const [done, setDone] = useState<{ onboardings: number; staff: number; devices: number } | null>(null);

  useEffect(() => {
    api<Role[]>("/roles").then(setRoles).catch(() => {});
    api<Building[]>("/buildings").then(setBuildings).catch(() => {});
  }, []);

  async function analyze() {
    if (!rawText.trim()) return;
    setAnalyzing(true);
    setError(null);
    setDone(null);
    try {
      const res = await api<AnalyzeResult>("/intake/analyze", {
        method: "POST",
        body: { rawText, hint },
      });
      setResult(res);
      setHires(res.newHires);
      setDevs(res.devices);
      setPeople(res.staff);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function commit() {
    setCommitting(true);
    setError(null);
    try {
      const payload = {
        newHires: hires
          .filter((h) => h.roleId && h.buildingId)
          .map((h) => ({ fullName: h.fullName, roleId: h.roleId!, buildingId: h.buildingId!, startDate: h.startDate ?? undefined })),
        devices: devs.map((d) => ({
          type: d.type, model: d.model ?? undefined, serialNumber: d.serialNumber ?? undefined,
          assetTag: d.assetTag ?? undefined, quantity: d.quantity, locationId: d.locationId || undefined,
        })),
        staff: people.map((p) => ({
          fullName: p.fullName, roleId: p.roleId ?? undefined, buildingId: p.buildingId ?? undefined,
          email: p.email ?? undefined, phone: p.phone ?? undefined,
        })),
      };
      const res = await api<{ onboardings: number; staff: number; devices: number }>("/intake/commit", {
        method: "POST",
        body: payload,
      });
      setDone(res);
      setResult(null);
      setHires([]); setDevs([]); setPeople([]);
      setRawText("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed");
    } finally {
      setCommitting(false);
    }
  }

  const totalRecords = hires.length + devs.length + people.length;
  const committableHires = hires.filter((h) => h.roleId && h.buildingId).length;

  return (
    <div className="space-y-5">
      {/* Console */}
      <section className="panel-raised overflow-hidden">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-accent text-white">
            <Wand2 size={17} />
          </div>
          <div className="flex-1">
            <h1 className="text-[15px] font-semibold text-ink">Paste anything — let the hub do the typing</h1>
            <p className="text-xs text-ink-soft">
              HR emails, device invoices, packing slips, or staff lists. It extracts the records; you just confirm.
            </p>
          </div>
        </div>
        <div className="p-5">
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={7}
            placeholder="Paste a new-hire email, a device shipment/invoice, or a list of people…"
            className="field font-mono text-xs leading-relaxed"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">Try:</span>
              {Object.entries(SAMPLES).map(([label, s]) => (
                <button
                  key={label}
                  onClick={() => { setRawText(s.text); setHint(s.hint); }}
                  className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-ink-soft transition hover:border-accent/40 hover:text-accent"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <select value={hint} onChange={(e) => setHint(e.target.value)} className="field-sm">
                <option value="AUTO">Auto-detect</option>
                <option value="NEW_HIRE">New hire</option>
                <option value="DEVICES">Devices</option>
                <option value="STAFF">Staff</option>
              </select>
              <button onClick={analyze} disabled={analyzing || !rawText.trim()} className="btn-primary">
                <Sparkles size={15} />
                {analyzing ? "Analyzing…" : "Analyze"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {error && <ErrorNote>{error}</ErrorNote>}

      {done && (
        <section className="panel-raised animate-rise p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-wash text-accent">
            <Check size={24} strokeWidth={2.5} />
          </div>
          <h2 className="font-display text-2xl font-semibold text-ink">Done — records created</h2>
          <p className="mt-1 text-sm text-ink-soft">The hub did the data entry for you.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {done.onboardings > 0 && <ResultLink href="/onboarding" n={done.onboardings} label="onboardings" />}
            {done.devices > 0 && <ResultLink href="/devices" n={done.devices} label="devices" />}
            {done.staff > 0 && <ResultLink href="/staff" n={done.staff} label="staff" />}
          </div>
        </section>
      )}

      {/* Review */}
      {result && (
        <section className="animate-rise space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-ink">Review &amp; confirm</h2>
              <Pill tone={result.source === "ai" ? "success" : "warn"} dot>
                {result.source === "ai" ? "AI extraction" : "Basic parser"}
              </Pill>
              <span className="text-xs text-ink-faint">{totalRecords} record{totalRecords === 1 ? "" : "s"}</span>
            </div>
            <button
              onClick={commit}
              disabled={committing || totalRecords === 0}
              className="btn-primary"
            >
              {committing ? "Creating…" : `Create ${committableHires + devs.length + people.length} record${committableHires + devs.length + people.length === 1 ? "" : "s"}`}
              {!committing && <ArrowRight size={15} />}
            </button>
          </div>

          {result.source === "basic" && (
            <div className="rounded-field border border-honey/25 bg-honey-wash px-3 py-2 text-xs text-honey">
              Parsed without AI (no LLM key configured). Add an <code className="font-mono">OPENAI_API_KEY</code> to
              unlock robust extraction from messy, free-form text.
            </div>
          )}
          {result.kind === "UNKNOWN" && totalRecords === 0 && (
            <div className="panel px-5 py-8 text-center text-sm text-ink-soft">
              Couldn&apos;t find records. Pick a type above (instead of Auto-detect) and analyze again.
            </div>
          )}

          {hires.length > 0 && (
            <ReviewGroup title="New hires → onboardings" count={hires.length}>
              {hires.map((h, i) => (
                <HireRow
                  key={i} hire={h} roles={roles} buildings={buildings}
                  onChange={(next) => setHires((arr) => arr.map((x, j) => (j === i ? next : x)))}
                  onRemove={() => setHires((arr) => arr.filter((_, j) => j !== i))}
                />
              ))}
            </ReviewGroup>
          )}

          {devs.length > 0 && (
            <ReviewGroup title="Devices → inventory" count={devs.reduce((n, d) => n + d.quantity, 0)}>
              {devs.map((d, i) => (
                <DeviceRow
                  key={i} dev={d} buildings={buildings}
                  onChange={(next) => setDevs((arr) => arr.map((x, j) => (j === i ? next : x)))}
                  onRemove={() => setDevs((arr) => arr.filter((_, j) => j !== i))}
                />
              ))}
            </ReviewGroup>
          )}

          {people.length > 0 && (
            <ReviewGroup title="Staff → directory" count={people.length}>
              {people.map((p, i) => (
                <StaffRow
                  key={i} person={p} roles={roles} buildings={buildings}
                  onChange={(next) => setPeople((arr) => arr.map((x, j) => (j === i ? next : x)))}
                  onRemove={() => setPeople((arr) => arr.filter((_, j) => j !== i))}
                />
              ))}
            </ReviewGroup>
          )}
        </section>
      )}
    </div>
  );
}

function ResultLink({ href, n, label }: { href: string; n: number; label: string }) {
  return (
    <Link href={href} className="hover-lift flex items-center gap-2 rounded-card border border-line bg-surface px-4 py-2.5 shadow-soft">
      <span className="numeral text-2xl font-semibold text-ink">{n}</span>
      <span className="text-sm text-ink-soft">{label}</span>
      <ArrowRight size={14} className="text-ink-faint" />
    </Link>
  );
}

function ReviewGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="panel overflow-hidden">
      <header className="flex items-center justify-between border-b border-line bg-paper-deep/30 px-5 py-2.5">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        <span className="font-mono text-[11px] text-ink-soft">{count}</span>
      </header>
      <div className="divide-y divide-line">{children}</div>
    </div>
  );
}

function fieldRow(label: string, node: React.ReactNode) {
  return (
    <label className="block">
      <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink-faint">{label}</span>
      {node}
    </label>
  );
}

function HireRow({
  hire, roles, buildings, onChange, onRemove,
}: {
  hire: Hire; roles: Role[]; buildings: Building[];
  onChange: (h: Hire) => void; onRemove: () => void;
}) {
  const missing = !hire.roleId || !hire.buildingId;
  return (
    <div className={cn("px-5 py-3.5", missing && "bg-honey-wash/30")}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1.4fr_1.4fr_1fr_auto] sm:items-end">
        {fieldRow("Full name",
          <input value={hire.fullName} onChange={(e) => onChange({ ...hire, fullName: e.target.value })} className="field-sm mt-1 w-full" />)}
        {fieldRow("Role",
          <select value={hire.roleId ?? ""} onChange={(e) => onChange({ ...hire, roleId: e.target.value || null })}
            className={cn("field-sm mt-1 w-full", !hire.roleId && "border-honey")}>
            <option value="">— pick role —</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>)}
        {fieldRow("Building",
          <select value={hire.buildingId ?? ""} onChange={(e) => onChange({ ...hire, buildingId: e.target.value || null })}
            className={cn("field-sm mt-1 w-full", !hire.buildingId && "border-honey")}>
            <option value="">— pick building —</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>)}
        {fieldRow("Start date",
          <input type="date" value={hire.startDate ?? ""} onChange={(e) => onChange({ ...hire, startDate: e.target.value || null })} className="field-sm mt-1 w-full" />)}
        <button onClick={onRemove} className="mb-1 flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-clay-wash hover:text-clay" title="Remove">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-ink-faint">
        {hire.adPrefix && <span>AD: <span className="font-mono text-accent">{hire.adPrefix}</span></span>}
        {missing && <span className="text-honey">Pick a role &amp; building to include this row.</span>}
      </div>
    </div>
  );
}

function DeviceRow({
  dev, buildings, onChange, onRemove,
}: {
  dev: Dev; buildings: Building[]; onChange: (d: Dev) => void; onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 px-5 py-3.5 sm:grid-cols-[1fr_1.4fr_1.2fr_1fr_0.7fr_1.2fr_auto] sm:items-end">
      {fieldRow("Type",
        <select value={dev.type} onChange={(e) => onChange({ ...dev, type: e.target.value })} className="field-sm mt-1 w-full">
          {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>)}
      {fieldRow("Model",
        <input value={dev.model ?? ""} onChange={(e) => onChange({ ...dev, model: e.target.value || null })} className="field-sm mt-1 w-full" />)}
      {fieldRow("Serial",
        <input value={dev.serialNumber ?? ""} onChange={(e) => onChange({ ...dev, serialNumber: e.target.value || null })} className="field-sm mt-1 w-full font-mono" />)}
      {fieldRow("Asset tag",
        <input value={dev.assetTag ?? ""} onChange={(e) => onChange({ ...dev, assetTag: e.target.value || null })} className="field-sm mt-1 w-full font-mono" />)}
      {fieldRow("Qty",
        <input type="number" min={1} value={dev.quantity} onChange={(e) => onChange({ ...dev, quantity: Math.max(1, Number(e.target.value) || 1) })} className="field-sm mt-1 w-full" />)}
      {fieldRow("Location",
        <select value={dev.locationId ?? ""} onChange={(e) => onChange({ ...dev, locationId: e.target.value })} className="field-sm mt-1 w-full">
          <option value="">—</option>
          {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>)}
      <button onClick={onRemove} className="mb-1 flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-clay-wash hover:text-clay" title="Remove">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function StaffRow({
  person, roles, buildings, onChange, onRemove,
}: {
  person: Person; roles: Role[]; buildings: Building[]; onChange: (p: Person) => void; onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 px-5 py-3.5 sm:grid-cols-[1.4fr_1.2fr_1.2fr_1.2fr_auto] sm:items-end">
      {fieldRow("Full name",
        <input value={person.fullName} onChange={(e) => onChange({ ...person, fullName: e.target.value })} className="field-sm mt-1 w-full" />)}
      {fieldRow("Role",
        <select value={person.roleId ?? ""} onChange={(e) => onChange({ ...person, roleId: e.target.value || null })} className="field-sm mt-1 w-full">
          <option value="">—</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>)}
      {fieldRow("Building",
        <select value={person.buildingId ?? ""} onChange={(e) => onChange({ ...person, buildingId: e.target.value || null })} className="field-sm mt-1 w-full">
          <option value="">—</option>
          {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>)}
      {fieldRow("Email",
        <input value={person.email ?? ""} onChange={(e) => onChange({ ...person, email: e.target.value || null })} className="field-sm mt-1 w-full" />)}
      <button onClick={onRemove} className="mb-1 flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-clay-wash hover:text-clay" title="Remove">
        <Trash2 size={14} />
      </button>
    </div>
  );
}
