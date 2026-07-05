"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Wand2, Trash2, ArrowRight, Check, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, ErrorNote, type Tone } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const DEVICE_TYPES = [
  "LAPTOP", "SURFACE", "PHONE", "TABLET", "HEADSET",
  "DOCK", "MONITOR", "MINI_PC", "USB_ADAPTER", "KEYBOARD",
  "MOUSE", "WEBCAM", "CABLE", "ADAPTER", "OTHER",
] as const;
const DOC_TYPES = ["INVOICE", "RECEIPT", "QUOTE"] as const;
const TASK_TYPES = [
  "OTHER", "INSTALL", "ASSIGN_DEVICE", "RETURN_DEVICE", "REPAIR",
  "SETUP", "ACCESS", "PROCUREMENT", "AUDIT", "ONBOARDING", "OFFBOARDING",
] as const;

type SegmentKind = "TICKET" | "NEW_HIRE" | "STAFF" | "DEVICES" | "INVOICE" | "TASK" | "UNKNOWN";

const KIND_META: Record<SegmentKind, { label: string; tone: Tone }> = {
  TICKET: { label: "Ticket", tone: "danger" },
  NEW_HIRE: { label: "New hire", tone: "success" },
  STAFF: { label: "Staff", tone: "info" },
  DEVICES: { label: "Devices", tone: "accent" },
  INVOICE: { label: "Invoice", tone: "warn" },
  TASK: { label: "Task", tone: "neutral" },
  UNKNOWN: { label: "Unknown", tone: "neutral" },
};

interface Role { id: string; title: string }
interface Building { id: string; name: string }

interface PossibleDuplicate { staffId: string; fullName: string; similarity: number }

interface AnalyzeResult {
  newHires: Array<{
    fullName: string; roleTitle: string | null; roleId: string | null;
    buildingName: string | null; buildingId: string | null;
    startDate: string | null; adPrefix: string | null; unresolved: string[];
    possibleDuplicate: PossibleDuplicate | null;
  }>;
  devices: Array<{
    type: string; model: string | null; serialNumber: string | null;
    assetTag: string | null; quantity: number;
  }>;
  staff: Array<{
    fullName: string; roleTitle: string | null; roleId: string | null;
    buildingName: string | null; buildingId: string | null;
    email: string | null; phone: string | null;
    possibleDuplicate: PossibleDuplicate | null;
  }>;
}

type Hire = AnalyzeResult["newHires"][number] & { locationId?: string; confirmDuplicate?: boolean };
type Dev = AnalyzeResult["devices"][number] & { locationId?: string };
type Person = AnalyzeResult["staff"][number] & { confirmDuplicate?: boolean };

interface InvoiceItem {
  description: string;
  quantity: number;
  unitCost: number | null;
  serialNumbers: string[];
  mappedType: string | null;
}
interface InvoiceState { vendor: string; docType: string; items: InvoiceItem[] }
interface TicketState { subject: string; body: string; requesterName: string }
interface TaskState { title: string; description: string; type: string }

interface ClassifySegment {
  text: string;
  kind: SegmentKind;
  summary: string;
  requesterNameGuess: string | null;
}

interface Segment {
  id: string;
  text: string;
  kind: SegmentKind;
  summary: string;
  requesterNameGuess: string | null;
  loading: boolean;
  error: string | null;
  hires: Hire[];
  devices: Dev[];
  staff: Person[];
  invoice: InvoiceState | null;
  ticket: TicketState | null;
  task: TaskState | null;
}

interface DoneSummary {
  onboardings: number;
  staff: number;
  devices: number;
  tickets: number;
  tasks: number;
  invoiceDevices: number;
  duplicatesSkipped: Array<{ fullName: string; existingStaffId: string; similarity: number }>;
  errors: Array<{ label: string; message: string }>;
}

const SAMPLES: Record<string, string> = {
  "New-hire email": `Hi IT — please set up our new leasing consultant.

Name: Priya Anand
Role: Leasing Consultant
Building: Birch House
Start date: 2026-06-22

Thanks!`,
  "Device shipment": `Order #DL-99421 received:
Dell Latitude 5450 laptop  S/N: 7QX2K93  asset: LAP-3310
2x Jabra Evolve2 65 headset
iPhone 15  serial: G99TLM2
Dell U2724 monitor x3`,
  "Mixed note": `Hi IT,

Quick heads up that our new hire Marcus Webb starts Monday as a Maintenance Tech at Birch House.

Also — completely separate thing — the printer on the 3rd floor at Cedar Court is jammed again and won't print anything. Someone needs to look at it today.

Thanks,
Dana`,
  "Invoice": `Invoice #INV-88213 — Staples Business
Logitech MX Master 3 mouse  qty 2  $79.99 each
Dell 27" monitor U2724D  $349.00  S/N: 5KX881Q
HDMI cable 6ft  qty 5  $8.50`,
};

export default function IntakePage() {
  return (
    <AppShell eyebrow="Automation" title="Smart Intake">
      {() => <IntakeConsole />}
    </AppShell>
  );
}

function newSegmentId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function IntakeConsole() {
  const [rawText, setRawText] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classifySource, setClassifySource] = useState<"ai" | "basic" | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);

  const [roles, setRoles] = useState<Role[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [committing, setCommitting] = useState(false);
  const [done, setDone] = useState<DoneSummary | null>(null);

  useEffect(() => {
    api<Role[]>("/roles").then(setRoles).catch(() => {});
    api<Building[]>("/buildings").then(setBuildings).catch(() => {});
  }, []);

  function updateSegment(id: string, updater: (s: Segment) => Segment) {
    setSegments((arr) => arr.map((s) => (s.id === id ? updater(s) : s)));
  }

  /** Fire the kind-specific extraction call for one segment and fill in its editable state. */
  async function extractForSegment(id: string, text: string, kind: SegmentKind, requesterNameGuess: string | null) {
    updateSegment(id, (s) => ({ ...s, kind, loading: kind !== "TASK" && kind !== "UNKNOWN", error: null }));
    try {
      if (kind === "NEW_HIRE" || kind === "STAFF" || kind === "DEVICES") {
        const res = await api<AnalyzeResult>("/intake/analyze", { method: "POST", body: { rawText: text, hint: kind } });
        updateSegment(id, (s) => ({ ...s, loading: false, hires: res.newHires, devices: res.devices, staff: res.staff }));
      } else if (kind === "INVOICE") {
        const res = await api<{ source: "ai" | "basic"; items: InvoiceItem[] }>("/procurement/extract", {
          method: "POST", body: { rawText: text },
        });
        updateSegment(id, (s) => ({ ...s, loading: false, invoice: { vendor: "", docType: "INVOICE", items: res.items } }));
      } else if (kind === "TICKET") {
        const res = await api<{ subject: string; body: string; requester: { fullName: string } | null }>(
          "/tickets/preview", { method: "POST", body: { rawText: text } },
        );
        updateSegment(id, (s) => ({
          ...s, loading: false,
          ticket: { subject: res.subject, body: res.body, requesterName: requesterNameGuess ?? res.requester?.fullName ?? "" },
        }));
      } else if (kind === "TASK") {
        updateSegment(id, (s) => ({
          ...s, loading: false,
          task: { title: s.summary || text.split(/\r?\n/)[0]?.slice(0, 200) || "Follow up", description: text, type: "OTHER" },
        }));
      } else {
        updateSegment(id, (s) => ({ ...s, loading: false }));
      }
    } catch (err) {
      updateSegment(id, (s) => ({ ...s, loading: false, error: err instanceof ApiError ? err.message : "Extraction failed" }));
    }
  }

  async function classify() {
    if (!rawText.trim()) return;
    setClassifying(true);
    setError(null);
    setDone(null);
    setSegments([]);
    try {
      const res = await api<{ source: "ai" | "basic"; segments: ClassifySegment[] }>("/intake/classify", {
        method: "POST", body: { rawText },
      });
      setClassifySource(res.source);
      const initial: Segment[] = res.segments.map((seg) => ({
        id: newSegmentId(),
        text: seg.text,
        kind: seg.kind,
        summary: seg.summary,
        requesterNameGuess: seg.requesterNameGuess,
        loading: seg.kind !== "UNKNOWN",
        error: null,
        hires: [], devices: [], staff: [],
        invoice: null, ticket: null, task: null,
      }));
      setSegments(initial);
      // Fire each segment's extraction in parallel — cards fill in progressively.
      initial.forEach((seg) => {
        if (seg.kind !== "UNKNOWN") void extractForSegment(seg.id, seg.text, seg.kind, seg.requesterNameGuess);
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Classification failed");
    } finally {
      setClassifying(false);
    }
  }

  async function commitAll() {
    setCommitting(true);
    setError(null);
    const summary: DoneSummary = {
      onboardings: 0, staff: 0, devices: 0, tickets: 0, tasks: 0, invoiceDevices: 0,
      duplicatesSkipped: [], errors: [],
    };
    try {
      // NEW_HIRE/STAFF/DEVICES segments merge into one /intake/commit call.
      const newHires = segments.flatMap((s) => (s.kind === "NEW_HIRE" ? s.hires : []))
        .filter((h) => h.roleId && h.buildingId)
        .map((h) => ({
          fullName: h.fullName, roleId: h.roleId!, buildingId: h.buildingId!,
          startDate: h.startDate ?? undefined, confirmDuplicate: h.confirmDuplicate,
        }));
      const devices = segments.flatMap((s) => (s.kind === "DEVICES" ? s.devices : []))
        .map((d) => ({
          type: d.type, model: d.model ?? undefined, serialNumber: d.serialNumber ?? undefined,
          assetTag: d.assetTag ?? undefined, quantity: d.quantity, locationId: d.locationId || undefined,
        }));
      const staff = segments.flatMap((s) => (s.kind === "STAFF" ? s.staff : []))
        .map((p) => ({
          fullName: p.fullName, roleId: p.roleId ?? undefined, buildingId: p.buildingId ?? undefined,
          email: p.email ?? undefined, phone: p.phone ?? undefined, confirmDuplicate: p.confirmDuplicate,
        }));
      if (newHires.length || devices.length || staff.length) {
        const res = await api<{
          onboardings: number; staff: number; devices: number;
          duplicatesSkipped: DoneSummary["duplicatesSkipped"];
          errors: Array<{ kind: string; label: string; message: string }>;
        }>("/intake/commit", { method: "POST", body: { newHires, devices, staff } });
        summary.onboardings += res.onboardings;
        summary.staff += res.staff;
        summary.devices += res.devices;
        summary.duplicatesSkipped.push(...res.duplicatesSkipped);
        summary.errors.push(...res.errors.map((e) => ({ label: e.label, message: e.message })));
      }

      // Each INVOICE segment: create doc -> add line items -> process, in sequence.
      for (const seg of segments) {
        if (seg.kind !== "INVOICE" || !seg.invoice || seg.invoice.items.length === 0) continue;
        try {
          const doc = await api<{ id: string }>("/procurement", {
            method: "POST",
            body: { docType: seg.invoice.docType, vendor: seg.invoice.vendor || undefined },
          });
          await api(`/procurement/${doc.id}/line-items`, {
            method: "POST",
            body: { lineItems: seg.invoice.items.map((it) => ({
              description: it.description, quantity: it.quantity,
              unitCost: it.unitCost ?? undefined, serialNumbers: it.serialNumbers,
              mappedType: it.mappedType ?? undefined,
            })) },
          });
          const processed = await api<{ devicesCreated: number }>(`/procurement/${doc.id}/process`, { method: "POST" });
          summary.invoiceDevices += processed.devicesCreated ?? 0;
        } catch (err) {
          summary.errors.push({ label: seg.summary || "Invoice", message: err instanceof ApiError ? err.message : "Failed to process invoice" });
        }
      }

      // Each TICKET segment.
      for (const seg of segments) {
        if (seg.kind !== "TICKET" || !seg.ticket) continue;
        try {
          await api("/tickets/draft", {
            method: "POST",
            body: { subject: seg.ticket.subject, body: seg.ticket.body, requesterName: seg.ticket.requesterName || undefined },
          });
          summary.tickets++;
        } catch (err) {
          summary.errors.push({ label: seg.summary || "Ticket", message: err instanceof ApiError ? err.message : "Failed to create ticket" });
        }
      }

      // Each TASK segment.
      for (const seg of segments) {
        if (seg.kind !== "TASK" || !seg.task) continue;
        try {
          await api("/tasks", {
            method: "POST",
            body: { title: seg.task.title, description: seg.task.description || undefined, type: seg.task.type, source: "INTAKE" },
          });
          summary.tasks++;
        } catch (err) {
          summary.errors.push({ label: seg.summary || "Task", message: err instanceof ApiError ? err.message : "Failed to create task" });
        }
      }

      setDone(summary);
      setSegments([]);
      setRawText("");
      setClassifySource(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed");
    } finally {
      setCommitting(false);
    }
  }

  const committableCount = segments.reduce((n, s) => {
    if (s.kind === "NEW_HIRE") return n + s.hires.filter((h) => h.roleId && h.buildingId).length;
    if (s.kind === "STAFF") return n + s.staff.length;
    if (s.kind === "DEVICES") return n + s.devices.reduce((m, d) => m + d.quantity, 0);
    if (s.kind === "INVOICE") return n + ((s.invoice?.items.length ?? 0) > 0 ? 1 : 0);
    if (s.kind === "TICKET") return n + (s.ticket ? 1 : 0);
    if (s.kind === "TASK") return n + (s.task ? 1 : 0);
    return n;
  }, 0);
  const hasUnknown = segments.some((s) => s.kind === "UNKNOWN");

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
              An email, a ticket, an invoice, a staff list — even a mixed note about several things. It splits, classifies, and routes each part; you just confirm.
            </p>
          </div>
        </div>
        <div className="p-5">
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={7}
            placeholder="Paste anything from work…"
            className="field font-mono text-xs leading-relaxed"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">Try:</span>
              {Object.entries(SAMPLES).map(([label, text]) => (
                <button
                  key={label}
                  onClick={() => setRawText(text)}
                  className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-ink-soft transition hover:border-accent/40 hover:text-accent"
                >
                  {label}
                </button>
              ))}
            </div>
            <button onClick={classify} disabled={classifying || !rawText.trim()} className="btn-primary">
              <Sparkles size={15} />
              {classifying ? "Classifying…" : "Classify"}
            </button>
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
            {(done.devices > 0 || done.invoiceDevices > 0) && (
              <ResultLink href="/devices" n={done.devices + done.invoiceDevices} label="devices" />
            )}
            {done.staff > 0 && <ResultLink href="/staff" n={done.staff} label="staff" />}
            {done.tickets > 0 && <ResultLink href="/tickets" n={done.tickets} label="tickets" />}
            {done.tasks > 0 && <ResultLink href="/tasks" n={done.tasks} label="tasks" />}
          </div>
          {done.duplicatesSkipped.length > 0 && (
            <div className="mx-auto mt-4 max-w-md rounded-field border border-honey/25 bg-honey-wash px-3 py-2 text-left text-xs text-honey">
              Skipped {done.duplicatesSkipped.length} row{done.duplicatesSkipped.length === 1 ? "" : "s"} that
              closely matched an existing staff member — nothing was created for:{" "}
              {done.duplicatesSkipped.map((d) => d.fullName).join(", ")}. Re-run intake and tick
              &quot;create anyway&quot; on that row if it&apos;s genuinely a different person.
            </div>
          )}
          {done.errors.length > 0 && (
            <div className="mx-auto mt-4 max-w-md rounded-field border border-clay/25 bg-clay-wash px-3 py-2 text-left text-xs text-clay">
              {done.errors.length} item{done.errors.length === 1 ? "" : "s"} failed to create — everything else
              above went through fine:
              <ul className="mt-1 list-disc pl-4">
                {done.errors.map((e, i) => (
                  <li key={i}><span className="font-medium">{e.label}</span> — {e.message}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Review */}
      {segments.length > 0 && (
        <section className="animate-rise space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-ink">Review &amp; confirm</h2>
              <Pill tone={classifySource === "ai" ? "success" : "warn"} dot>
                {classifySource === "ai" ? "AI classification" : "Basic parser"}
              </Pill>
              <span className="text-xs text-ink-faint">{segments.length} segment{segments.length === 1 ? "" : "s"}</span>
            </div>
            <button onClick={commitAll} disabled={committing || committableCount === 0} className="btn-primary">
              {committing ? "Creating…" : `Create ${committableCount} record${committableCount === 1 ? "" : "s"}`}
              {!committing && <ArrowRight size={15} />}
            </button>
          </div>

          {classifySource === "basic" && (
            <div className="rounded-field border border-honey/25 bg-honey-wash px-3 py-2 text-xs text-honey">
              Split without AI (no LLM key configured) — a cruder paragraph-based split. Add an{" "}
              <code className="font-mono">OPENAI_API_KEY</code> for real topic-aware splitting.
            </div>
          )}
          {hasUnknown && (
            <div className="rounded-field border border-honey/25 bg-honey-wash px-3 py-2 text-xs text-honey">
              One or more segments couldn&apos;t be classified — pick a category on them below to include them.
            </div>
          )}

          {segments.map((seg) => (
            <SegmentCard
              key={seg.id}
              segment={seg}
              roles={roles}
              buildings={buildings}
              onKindChange={(kind) => void extractForSegment(seg.id, seg.text, kind, seg.requesterNameGuess)}
              onRetry={() => void extractForSegment(seg.id, seg.text, seg.kind, seg.requesterNameGuess)}
              onRemove={() => setSegments((arr) => arr.filter((s) => s.id !== seg.id))}
              onUpdate={(updater) => updateSegment(seg.id, updater)}
            />
          ))}
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

function fieldRow(label: string, node: React.ReactNode) {
  return (
    <label className="block">
      <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink-faint">{label}</span>
      {node}
    </label>
  );
}

function SegmentCard({
  segment, roles, buildings, onKindChange, onRetry, onRemove, onUpdate,
}: {
  segment: Segment;
  roles: Role[];
  buildings: Building[];
  onKindChange: (kind: SegmentKind) => void;
  onRetry: () => void;
  onRemove: () => void;
  onUpdate: (updater: (s: Segment) => Segment) => void;
}) {
  const meta = KIND_META[segment.kind];
  return (
    <div className="panel overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-paper-deep/30 px-5 py-2.5">
        <Pill tone={meta.tone} dot>{meta.label}</Pill>
        <select
          value={segment.kind}
          onChange={(e) => onKindChange(e.target.value as SegmentKind)}
          className="field-sm"
          title="Override category"
        >
          {(Object.keys(KIND_META) as SegmentKind[]).map((k) => (
            <option key={k} value={k}>{KIND_META[k].label}</option>
          ))}
        </select>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">{segment.summary}</span>
        {segment.loading && <RefreshCw size={13} className="animate-spin text-ink-faint" />}
        <button onClick={onRemove} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-clay-wash hover:text-clay" title="Remove segment">
          <Trash2 size={13} />
        </button>
      </header>

      {segment.error && (
        <div className="flex items-center gap-2 border-b border-line px-5 py-2 text-xs text-clay">
          {segment.error}
          <button onClick={onRetry} className="ml-auto rounded-full border border-clay/30 px-2 py-0.5 text-[11px] font-medium hover:border-clay">
            Retry
          </button>
        </div>
      )}

      {segment.kind === "UNKNOWN" && !segment.loading && (
        <div className="px-5 py-4 text-sm text-ink-soft">
          Couldn&apos;t classify this segment — pick a category above to include it.
        </div>
      )}

      <div className="divide-y divide-line">
        {segment.hires.map((h, i) => (
          <HireRow
            key={i} hire={h} roles={roles} buildings={buildings}
            onChange={(next) => onUpdate((s) => ({ ...s, hires: s.hires.map((x, j) => (j === i ? next : x)) }))}
            onRemove={() => onUpdate((s) => ({ ...s, hires: s.hires.filter((_, j) => j !== i) }))}
          />
        ))}
        {segment.devices.map((d, i) => (
          <DeviceRow
            key={i} dev={d} buildings={buildings}
            onChange={(next) => onUpdate((s) => ({ ...s, devices: s.devices.map((x, j) => (j === i ? next : x)) }))}
            onRemove={() => onUpdate((s) => ({ ...s, devices: s.devices.filter((_, j) => j !== i) }))}
            onSplitSerial={() =>
              onUpdate((s) => ({
                ...s,
                devices: s.devices.flatMap((x, j) => {
                  if (j !== i) return [x];
                  return [{ ...x, quantity: 1 }, { ...x, quantity: x.quantity - 1, serialNumber: null }];
                }),
              }))
            }
          />
        ))}
        {segment.staff.map((p, i) => (
          <StaffRow
            key={i} person={p} roles={roles} buildings={buildings}
            onChange={(next) => onUpdate((s) => ({ ...s, staff: s.staff.map((x, j) => (j === i ? next : x)) }))}
            onRemove={() => onUpdate((s) => ({ ...s, staff: s.staff.filter((_, j) => j !== i) }))}
          />
        ))}
        {segment.invoice && (
          <InvoiceEditor
            invoice={segment.invoice}
            onChange={(next) => onUpdate((s) => ({ ...s, invoice: next }))}
          />
        )}
        {segment.ticket && (
          <TicketPreviewRow
            ticket={segment.ticket}
            onChange={(next) => onUpdate((s) => ({ ...s, ticket: next }))}
          />
        )}
        {segment.task && (
          <TaskRow
            task={segment.task}
            onChange={(next) => onUpdate((s) => ({ ...s, task: next }))}
          />
        )}
      </div>
    </div>
  );
}

function DuplicateWarning({
  dup, confirmed, onConfirm,
}: { dup: PossibleDuplicate; confirmed: boolean; onConfirm: (v: boolean) => void }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-field border border-clay/25 bg-clay-wash px-2.5 py-1.5 text-[11px] text-clay">
      <span>
        Looks like an existing staff member: <span className="font-medium">{dup.fullName}</span>{" "}
        ({Math.round(dup.similarity * 100)}% match). Won&apos;t create unless confirmed.
      </span>
      <label className="ml-auto flex shrink-0 items-center gap-1.5">
        <input type="checkbox" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} />
        Create anyway
      </label>
    </div>
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
      {hire.possibleDuplicate && <DuplicateWarning dup={hire.possibleDuplicate} confirmed={!!hire.confirmDuplicate} onConfirm={(v) => onChange({ ...hire, confirmDuplicate: v })} />}
    </div>
  );
}

function DeviceRow({
  dev, buildings, onChange, onRemove, onSplitSerial,
}: {
  dev: Dev; buildings: Building[]; onChange: (d: Dev) => void; onRemove: () => void; onSplitSerial: () => void;
}) {
  const serialLostToQuantity = dev.quantity > 1 && !!dev.serialNumber;
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
      {serialLostToQuantity && (
        <div className="col-span-full flex items-center gap-2 rounded-field border border-honey/25 bg-honey-wash px-2.5 py-1.5 text-[11px] text-honey">
          <span>
            One serial can&apos;t cover {dev.quantity} units — only the first unit will keep{" "}
            <span className="font-mono">{dev.serialNumber}</span>; the rest will be created with no serial.
          </span>
          <button onClick={onSplitSerial} className="ml-auto shrink-0 rounded-full border border-honey/40 px-2 py-0.5 font-medium transition hover:border-honey">
            Split into separate rows
          </button>
        </div>
      )}
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
      {person.possibleDuplicate && (
        <div className="col-span-full">
          <DuplicateWarning dup={person.possibleDuplicate} confirmed={!!person.confirmDuplicate} onConfirm={(v) => onChange({ ...person, confirmDuplicate: v })} />
        </div>
      )}
    </div>
  );
}

function InvoiceEditor({ invoice, onChange }: { invoice: InvoiceState; onChange: (v: InvoiceState) => void }) {
  return (
    <div className="px-5 py-3.5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr]">
        {fieldRow("Vendor",
          <input value={invoice.vendor} onChange={(e) => onChange({ ...invoice, vendor: e.target.value })} className="field-sm mt-1 w-full" />)}
        {fieldRow("Doc type",
          <select value={invoice.docType} onChange={(e) => onChange({ ...invoice, docType: e.target.value })} className="field-sm mt-1 w-full">
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>)}
      </div>
      <div className="mt-3 space-y-2">
        {invoice.items.map((it, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 rounded-field border border-line px-3 py-2 sm:grid-cols-[1.6fr_0.6fr_0.8fr_1fr_auto] sm:items-end">
            {fieldRow("Description",
              <input value={it.description} onChange={(e) => onChange({ ...invoice, items: invoice.items.map((x, j) => j === i ? { ...x, description: e.target.value } : x) })} className="field-sm mt-1 w-full" />)}
            {fieldRow("Qty",
              <input type="number" min={1} value={it.quantity} onChange={(e) => onChange({ ...invoice, items: invoice.items.map((x, j) => j === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x) })} className="field-sm mt-1 w-full" />)}
            {fieldRow("Unit cost",
              <input type="number" step="0.01" value={it.unitCost ?? ""} onChange={(e) => onChange({ ...invoice, items: invoice.items.map((x, j) => j === i ? { ...x, unitCost: e.target.value === "" ? null : Number(e.target.value) } : x) })} className="field-sm mt-1 w-full" />)}
            {fieldRow("Type",
              <select value={it.mappedType ?? ""} onChange={(e) => onChange({ ...invoice, items: invoice.items.map((x, j) => j === i ? { ...x, mappedType: e.target.value || null } : x) })} className="field-sm mt-1 w-full">
                <option value="">—</option>
                {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>)}
            <button onClick={() => onChange({ ...invoice, items: invoice.items.filter((_, j) => j !== i) })} className="mb-1 flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-clay-wash hover:text-clay" title="Remove">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {invoice.items.length === 0 && <p className="text-xs text-ink-faint">No line items extracted.</p>}
      </div>
    </div>
  );
}

function TicketPreviewRow({ ticket, onChange }: { ticket: TicketState; onChange: (v: TicketState) => void }) {
  return (
    <div className="space-y-3 px-5 py-3.5">
      {fieldRow("Subject",
        <input value={ticket.subject} onChange={(e) => onChange({ ...ticket, subject: e.target.value })} className="field-sm mt-1 w-full" />)}
      {fieldRow("Body",
        <textarea value={ticket.body} onChange={(e) => onChange({ ...ticket, body: e.target.value })} rows={3} className="field-sm mt-1 w-full" />)}
      {fieldRow("Requester (optional)",
        <input value={ticket.requesterName} onChange={(e) => onChange({ ...ticket, requesterName: e.target.value })} placeholder="Name" className="field-sm mt-1 w-full max-w-xs" />)}
    </div>
  );
}

function TaskRow({ task, onChange }: { task: TaskState; onChange: (v: TaskState) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 px-5 py-3.5 sm:grid-cols-[1.4fr_1fr]">
      {fieldRow("Title",
        <input value={task.title} onChange={(e) => onChange({ ...task, title: e.target.value })} className="field-sm mt-1 w-full" />)}
      {fieldRow("Type",
        <select value={task.type} onChange={(e) => onChange({ ...task, type: e.target.value })} className="field-sm mt-1 w-full">
          {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>)}
      <div className="sm:col-span-2">
        {fieldRow("Description",
          <textarea value={task.description} onChange={(e) => onChange({ ...task, description: e.target.value })} rows={2} className="field-sm mt-1 w-full" />)}
      </div>
    </div>
  );
}
