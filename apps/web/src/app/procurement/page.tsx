"use client";

import { useCallback, useEffect, useState } from "react";
import { Receipt, Plus, PackageCheck, ArrowLeft, Wand2, Trash2, Paperclip, FileText, ExternalLink } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, SectionCard, ErrorNote, EmptyState, type Tone } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { getToken } from "@/lib/session";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const DEVICE_TYPES = [
  "LAPTOP", "SURFACE", "PHONE", "TABLET", "MONITOR", "KEYBOARD", "MOUSE",
  "HEADSET", "DOCK", "WEBCAM", "MINI_PC", "CABLE", "ADAPTER", "USB_ADAPTER", "OTHER",
] as const;
const DOC_TYPES = ["INVOICE", "RECEIPT", "QUOTE"] as const;

interface Building { id: string; name: string }
interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitCost: string | null;
  serialNumbers: string[];
  mappedType: string | null;
  reviewed: boolean;
  createdDeviceIds: string[];
}
interface DocListItem {
  id: string;
  vendor: string;
  docType: string;
  docNumber: string | null;
  destinationName: string | null;
  totalCost: string | null;
  status: string;
  hasFile: boolean;
  lineItemCount: number;
}
interface DocDetail {
  id: string;
  vendor: string;
  docType: string;
  docNumber: string | null;
  purchaseDate: string | null;
  destinationName: string | null;
  totalCost: string | null;
  status: string;
  hasFile: boolean;
  lineItems: LineItem[];
}

const STATUS_TONE: Record<string, Tone> = {
  UPLOADED: "neutral",
  EXTRACTED: "info",
  REVIEWED: "warn",
  PROCESSED: "success",
};

export default function ProcurementPage() {
  return (
    <AppShell eyebrow="Inventory" title="Procurement">
      {() => <ProcurementWorkspace />}
    </AppShell>
  );
}

function ProcurementWorkspace() {
  const [docs, setDocs] = useState<DocListItem[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selected, setSelected] = useState<DocDetail | null>(null);

  const refresh = useCallback(async () => {
    setDocs(await api<DocListItem[]>("/procurement"));
  }, []);

  useEffect(() => {
    void refresh();
    api<Building[]>("/buildings").then(setBuildings).catch(() => {});
  }, [refresh]);

  async function open(id: string) {
    setSelected(await api<DocDetail>(`/procurement/${id}`));
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        {selected ? (
          <DocDetailView
            doc={selected}
            buildings={buildings}
            onBack={() => setSelected(null)}
            onChanged={async (d) => { setSelected(d); await refresh(); }}
          />
        ) : (
          <SectionCard title="Purchase documents" count={docs.length}>
            {docs.length === 0 ? (
              <EmptyState
                icon={<Receipt size={18} />}
                title="No purchases yet"
                hint="Log a CDW quote, receipt, or invoice on the right — then process its items into inventory."
              />
            ) : (
              <ul className="divide-y divide-line">
                {docs.map((d) => (
                  <li key={d.id}>
                    <button onClick={() => open(d.id)} className="block w-full px-5 py-3.5 text-left transition hover:bg-paper-deep/40">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink">
                          {d.vendor} · {d.docType.toLowerCase()}{d.docNumber ? ` #${d.docNumber}` : ""}
                        </span>
                        <Pill tone={STATUS_TONE[d.status] ?? "neutral"} dot>{d.status.toLowerCase()}</Pill>
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-faint">
                        {d.destinationName ?? "no destination"} · {d.lineItemCount} line item{d.lineItemCount === 1 ? "" : "s"}
                        {d.totalCost ? ` · $${Number(d.totalCost).toFixed(2)}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}
      </div>

      <NewPurchasePanel buildings={buildings} onCreated={async (d) => { setSelected(d); await refresh(); }} />
    </div>
  );
}

function NewPurchasePanel({ buildings, onCreated }: { buildings: Building[]; onCreated: (d: DocDetail) => void }) {
  const [vendor, setVendor] = useState("CDW");
  const [docType, setDocType] = useState("INVOICE");
  const [docNumber, setDocNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await api<DocDetail>("/procurement", {
        method: "POST",
        body: {
          vendor: vendor || undefined,
          docType,
          docNumber: docNumber || undefined,
          purchaseDate: purchaseDate ? new Date(purchaseDate).toISOString() : undefined,
          destinationId: destinationId || undefined,
          totalCost: totalCost ? Number(totalCost) : undefined,
        },
      });
      setDocNumber(""); setPurchaseDate(""); setTotalCost("");
      onCreated(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel h-fit p-5">
      <h2 className="text-[15px] font-semibold text-ink">Log a purchase</h2>
      <p className="mt-1 text-xs text-ink-soft">Record a CDW quote, receipt, or invoice.</p>
      <form onSubmit={submit} className="mt-4 space-y-3.5 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[13px] font-medium text-ink-soft">
            Vendor
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} className="field mt-1.5" />
          </label>
          <label className="block text-[13px] font-medium text-ink-soft">
            Type
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className="field mt-1.5">
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-[13px] font-medium text-ink-soft">
          Document #
          <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} className="field mt-1.5" />
        </label>
        <label className="block text-[13px] font-medium text-ink-soft">
          Destination site
          <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)} className="field mt-1.5">
            <option value="">—</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[13px] font-medium text-ink-soft">
            Date
            <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="field mt-1.5" />
          </label>
          <label className="block text-[13px] font-medium text-ink-soft">
            Total $
            <input type="number" step="0.01" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} className="field mt-1.5" />
          </label>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Saving…" : "Create document"}
        </button>
      </form>
    </section>
  );
}

function DocDetailView({
  doc, buildings, onBack, onChanged,
}: {
  doc: DocDetail; buildings: Building[]; onBack: () => void; onChanged: (d: DocDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processed, setProcessed] = useState<number | null>(null);

  const pending = doc.lineItems.filter((li) => !li.reviewed).length;

  async function process() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<DocDetail & { devicesCreated: number }>(`/procurement/${doc.id}/process`, { method: "POST", body: {} });
      setProcessed(res.devicesCreated);
      onChanged(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Process failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft transition hover:text-ink">
        <ArrowLeft size={14} /> All purchases
      </button>

      <SectionCard
        title={`${doc.vendor} · ${doc.docType.toLowerCase()}${doc.docNumber ? ` #${doc.docNumber}` : ""}`}
        actions={<Pill tone={STATUS_TONE[doc.status] ?? "neutral"} dot>{doc.status.toLowerCase()}</Pill>}
        bodyClassName="px-5 py-4"
      >
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-soft">
          <span>Destination: <span className="text-ink">{doc.destinationName ?? "—"}</span></span>
          <span>Date: <span className="text-ink">{doc.purchaseDate ? new Date(doc.purchaseDate).toLocaleDateString() : "—"}</span></span>
          <span>Total: <span className="text-ink">{doc.totalCost ? `$${Number(doc.totalCost).toFixed(2)}` : "—"}</span></span>
        </div>
        <FileAttach doc={doc} onChanged={onChanged} />
      </SectionCard>

      {processed !== null && (
        <div className="animate-rise flex items-center gap-2 rounded-field border border-accent/20 bg-accent-wash px-3 py-2 text-sm text-accent-ink">
          <PackageCheck size={16} /> Created {processed} device{processed === 1 ? "" : "s"} in inventory, tagged to {doc.destinationName ?? "the destination"}.
        </div>
      )}

      <ExtractPanel docId={doc.id} onAdded={onChanged} />

      <SectionCard
        title="Line items"
        count={doc.lineItems.length}
        actions={
          pending > 0 ? (
            <button onClick={process} disabled={busy} className="btn-primary px-3 py-1.5 text-xs">
              <PackageCheck size={13} />
              {busy ? "Processing…" : `Process ${pending} into inventory`}
            </button>
          ) : (
            <Pill tone="success">all processed</Pill>
          )
        }
      >
        {error && <div className="px-5 pt-3"><ErrorNote>{error}</ErrorNote></div>}
        {doc.lineItems.length === 0 ? (
          <p className="px-5 py-4 text-xs text-ink-soft">No line items yet — add them below.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Item", "Type", "Qty", "Unit $", "Serials", ""].map((h, i) => (
                  <th key={i} className="px-5 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-ink-faint">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doc.lineItems.map((li) => (
                <tr key={li.id} className="border-b border-line/70 last:border-0">
                  <td className="px-5 py-2.5 text-ink">{li.description}</td>
                  <td className="px-5 py-2.5 text-ink-soft">{li.mappedType?.toLowerCase().replace(/_/g, " ") ?? "—"}</td>
                  <td className="px-5 py-2.5 font-mono text-xs">{li.quantity}</td>
                  <td className="px-5 py-2.5 font-mono text-xs text-ink-soft">{li.unitCost ? Number(li.unitCost).toFixed(2) : "—"}</td>
                  <td className="px-5 py-2.5 font-mono text-[11px] text-ink-faint">{li.serialNumbers.length || "—"}</td>
                  <td className="px-5 py-2.5 text-right">
                    {li.reviewed ? <Pill tone="success">{li.createdDeviceIds.length} created</Pill> : <Pill tone="warn">pending</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <AddLineItem docId={doc.id} onAdded={onChanged} />
      </SectionCard>
    </div>
  );
}

function FileAttach({ doc, onChanged }: { doc: DocDetail; onChanged: (d: DocDetail) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/procurement/${doc.id}/file`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      onChanged((await res.json()) as DocDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
      {doc.hasFile && (
        <a
          href={`${API_BASE}/api/procurement/${doc.id}/file`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-field border border-line bg-surface-raised px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent/40"
        >
          <FileText size={13} /> View attached file <ExternalLink size={11} />
        </a>
      )}
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-field border border-line bg-surface-raised px-3 py-1.5 text-xs text-ink-soft transition hover:border-line-strong hover:text-ink">
        <Paperclip size={13} />
        {busy ? "Uploading…" : doc.hasFile ? "Replace file" : "Attach invoice file"}
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif"
          className="hidden"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}
        />
      </label>
      {error && <span className="text-xs text-clay">{error}</span>}
    </div>
  );
}

interface Proposal {
  description: string;
  quantity: number;
  unitCost: number | null;
  serialNumbers: string[];
  mappedType: string | null;
}

function ExtractPanel({ docId, onAdded }: { docId: string; onAdded: (d: DocDetail) => void }) {
  const [rawText, setRawText] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"ai" | "basic" | null>(null);
  const [items, setItems] = useState<Proposal[]>([]);

  async function extract() {
    if (!rawText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ source: "ai" | "basic"; items: Proposal[] }>("/procurement/extract", {
        method: "POST",
        body: { rawText },
      });
      setSource(res.source);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  }

  async function addAll() {
    if (items.length === 0) return;
    setAdding(true);
    setError(null);
    try {
      const d = await api<DocDetail>(`/procurement/${docId}/line-items`, {
        method: "POST",
        body: {
          lineItems: items.map((i) => ({
            description: i.description,
            quantity: i.quantity,
            unitCost: i.unitCost ?? undefined,
            serialNumbers: i.serialNumbers,
            mappedType: i.mappedType ?? undefined,
          })),
        },
      });
      setItems([]);
      setRawText("");
      setSource(null);
      onAdded(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  }

  function patch(i: number, next: Partial<Proposal>) {
    setItems((arr) => arr.map((x, j) => (j === i ? { ...x, ...next } : x)));
  }

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent-wash text-accent">
          <Wand2 size={14} />
        </div>
        <div>
          <h3 className="text-[13px] font-semibold text-ink">Extract from invoice text</h3>
          <p className="text-[11px] text-ink-soft">Paste the invoice — it pulls out items, quantities, costs, and serials.</p>
        </div>
      </header>
      <div className="space-y-3 p-5">
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={4}
          placeholder={"Paste invoice lines, e.g.\n2x Dell Latitude 5450 Laptop  S/N: ABC123  $1,399.00\n3 Logitech MX Keys Keyboard  $99.00"}
          className="field font-mono text-xs leading-relaxed"
        />
        <div className="flex items-center justify-between gap-2">
          <button onClick={extract} disabled={busy || !rawText.trim()} className="btn-soft px-3 py-1.5 text-xs">
            <Wand2 size={13} />
            {busy ? "Reading…" : "Extract items"}
          </button>
          {source && (
            <Pill tone={source === "ai" ? "success" : "warn"} dot>
              {source === "ai" ? "AI extraction" : "Basic parser"}
            </Pill>
          )}
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        {items.length > 0 && (
          <div className="space-y-2 rounded-field border border-line bg-paper-deep/20 p-3">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1.2fr_0.6fr_0.8fr_1.4fr_auto]">
                <input value={it.description} onChange={(e) => patch(i, { description: e.target.value })} className="field-sm" />
                <select value={it.mappedType ?? ""} onChange={(e) => patch(i, { mappedType: e.target.value || null })} className="field-sm">
                  <option value="">— type —</option>
                  {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t.toLowerCase().replace(/_/g, " ")}</option>)}
                </select>
                <input type="number" min={1} value={it.quantity} onChange={(e) => patch(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} className="field-sm" />
                <input type="number" step="0.01" value={it.unitCost ?? ""} placeholder="$" onChange={(e) => patch(i, { unitCost: e.target.value ? Number(e.target.value) : null })} className="field-sm" />
                <input
                  value={it.serialNumbers.join(", ")}
                  onChange={(e) => patch(i, { serialNumbers: e.target.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) })}
                  placeholder="serials"
                  className="field-sm font-mono"
                />
                <button onClick={() => setItems((a) => a.filter((_, j) => j !== i))} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-clay-wash hover:text-clay">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button onClick={addAll} disabled={adding} className="btn-primary mt-1 px-3 py-1.5 text-xs">
              <Plus size={13} />
              {adding ? "Adding…" : `Add ${items.length} item${items.length === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function AddLineItem({ docId, onAdded }: { docId: string; onAdded: (d: DocDetail) => void }) {
  const [description, setDescription] = useState("");
  const [mappedType, setMappedType] = useState("LAPTOP");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [serials, setSerials] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const serialNumbers = serials.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      const d = await api<DocDetail>(`/procurement/${docId}/line-items`, {
        method: "POST",
        body: {
          lineItems: [{
            description,
            quantity: Math.max(1, Number(quantity) || 1),
            unitCost: unitCost ? Number(unitCost) : undefined,
            serialNumbers,
            mappedType,
          }],
        },
      });
      setDescription(""); setQuantity("1"); setUnitCost(""); setSerials("");
      onAdded(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="border-t border-line bg-paper-deep/20 px-5 py-4">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">Add line item</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1.2fr_0.6fr_0.8fr]">
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Dell Latitude 5450" className="field-sm" />
        <select value={mappedType} onChange={(e) => setMappedType(e.target.value)} className="field-sm">
          {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t.toLowerCase().replace(/_/g, " ")}</option>)}
        </select>
        <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Qty" className="field-sm" />
        <input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="Unit $" className="field-sm" />
      </div>
      <textarea
        value={serials}
        onChange={(e) => setSerials(e.target.value)}
        rows={2}
        placeholder="Serial numbers — one per line or comma-separated (optional)"
        className="field-sm mt-2 w-full font-mono"
      />
      {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}
      <button type="submit" disabled={busy || !description.trim()} className="btn-ghost mt-2 px-3 py-1.5 text-xs">
        <Plus size={13} />
        {busy ? "Adding…" : "Add item"}
      </button>
    </form>
  );
}
