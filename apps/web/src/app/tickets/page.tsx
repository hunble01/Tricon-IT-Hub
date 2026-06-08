"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles, RefreshCw, BookOpen, Send, Hand, UserCheck, Clock, AlertTriangle, User } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, ErrorNote, EmptyState, ticketBadge, type Tone } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type TicketStatus = "OPEN" | "PENDING" | "RESOLVED";
type SlaStateName = "on_track" | "at_risk" | "breached" | "met" | "none";

interface ContextHit { type: string; refTable: string | null; refId: string | null; score: number; snippet: string }
interface Draft {
  id: string;
  suggestedReply: string;
  suggestedNote: string | null;
  retrievedContext: ContextHit[] | null;
  model: string | null;
  createdAt: string;
}
interface Reply {
  id: string;
  body: string;
  internalNote: string | null;
  channel: string;
  mode: string;
  delivered: boolean;
  externalRef: string | null;
  createdAt: string;
  user: { id: string; name: string } | null;
}
interface Sla { state: SlaStateName; dueAt: string | null; hoursLeft: number | null }
interface Requester { id: string; fullName: string; email?: string | null; building?: { name: string } | null }
interface Assignee { id: string; name: string }
interface Ticket {
  id: string;
  source: string;
  externalId: string | null;
  subject: string;
  body: string;
  category: string | null;
  status: TicketStatus;
  priority: string;
  createdAt: string;
  slaDueAt: string | null;
  requester: Requester | null;
  assignedTo: Assignee | null;
  drafts: Draft[];
  replies?: Reply[];
  sla?: Sla;
  mine?: boolean;
}
interface QueueItem extends Ticket {
  sla: Sla;
  mine: boolean;
  _count?: { replies: number };
}
interface QueueResponse {
  counts: { total: number; open: number; mine: number; unassigned: number; breached: number; atRisk: number };
  items: QueueItem[];
}

const SOURCE_LABEL: Record<string, { label: string; tone: Tone }> = {
  MANUAL: { label: "Manual", tone: "neutral" },
  SERVICENOW: { label: "ServiceNow", tone: "info" },
  OUTLOOK: { label: "Outlook", tone: "accent" },
  ZENDESK: { label: "Zendesk", tone: "neutral" },
};
function sourceMeta(s: string): { label: string; tone: Tone } {
  return SOURCE_LABEL[s] ?? { label: s, tone: "neutral" };
}

function priorityMeta(p: string): { label: string; tone: Tone } {
  const map: Record<string, { label: string; tone: Tone }> = {
    URGENT: { label: "Urgent", tone: "danger" },
    HIGH: { label: "High", tone: "warn" },
    NORMAL: { label: "Normal", tone: "neutral" },
    LOW: { label: "Low", tone: "info" },
  };
  return map[p] ?? { label: p, tone: "neutral" };
}

/** Friendly label for a raw model id (e.g. claude-sonnet-4-6 → "Claude Sonnet"). */
function modelLabel(model: string | null): string {
  if (!model) return "Draft";
  const m = model.toLowerCase();
  if (m.includes("claude")) return "Claude";
  if (m.startsWith("gpt") || m.includes("openai")) return m.includes("4o") ? "GPT-4o" : "GPT";
  if (m === "stub") return "Stub";
  return model;
}

/**
 * The most recent drafting round: the latest draft per model. drafts arrive
 * newest-first; once we see a model a second time we've crossed into the
 * previous round, so stop. Returns one draft per model (e.g. Claude + GPT).
 */
function latestGeneration(drafts: Draft[]): Draft[] {
  const seen = new Set<string>();
  const out: Draft[] = [];
  for (const d of drafts) {
    const key = d.model ?? "?";
    if (seen.has(key)) break;
    seen.add(key);
    out.push(d);
  }
  return out;
}

function slaMeta(sla: Sla | undefined): { label: string; tone: Tone } | null {
  if (!sla) return null;
  switch (sla.state) {
    case "breached":
      return { label: "Past SLA", tone: "danger" };
    case "at_risk":
      return { label: sla.hoursLeft != null ? `${Math.max(0, Math.round(sla.hoursLeft))}h left` : "Due soon", tone: "warn" };
    case "on_track":
      return { label: sla.hoursLeft != null ? `${Math.round(sla.hoursLeft)}h left` : "On track", tone: "success" };
    case "met":
      return { label: "Met", tone: "success" };
    default:
      return null;
  }
}

export default function TicketsPage() {
  return (
    <AppShell eyebrow="Assist" title="Tickets">
      {() => <TicketsWorkspace />}
    </AppShell>
  );
}

function TicketsWorkspace() {
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [filter, setFilter] = useState<"all" | "mine" | "unassigned">("all");

  const refreshQueue = useCallback(async () => {
    const q = await api<QueueResponse>(`/tickets/queue${filter === "mine" ? "?mine=true" : ""}`);
    setQueue(q);
  }, [filter]);

  useEffect(() => { void refreshQueue(); }, [refreshQueue]);

  async function open(id: string) {
    setSelected(await api<Ticket>(`/tickets/${id}`));
  }

  async function reload(t: Ticket) {
    setSelected(t);
    void refreshQueue();
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <Drafter onDrafted={reload} />
        {selected && <TicketDetail ticket={selected} onChanged={reload} />}
      </div>
      <Queue
        queue={queue}
        filter={filter}
        onFilter={setFilter}
        selectedId={selected?.id ?? null}
        onSelect={open}
        onReindex={refreshQueue}
      />
    </div>
  );
}

function Drafter({ onDrafted }: { onDrafted: (t: Ticket) => void }) {
  const [rawText, setRawText] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [buildingHint, setBuildingHint] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rawText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const ticket = await api<Ticket>("/tickets/draft", {
        method: "POST",
        body: {
          rawText,
          requesterName: requesterName || undefined,
          buildingHint: buildingHint || undefined,
          category: category || undefined,
        },
      });
      setRawText(""); setRequesterName(""); setBuildingHint(""); setCategory("");
      onDrafted(ticket);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Draft failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel p-5">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent-wash text-accent">
          <Sparkles size={16} />
        </div>
        <div>
          <h1 className="text-[15px] font-semibold text-ink">Draft a reply</h1>
          <p className="text-xs text-ink-soft">
            Names are pseudonymized before anything leaves for the model, then restored.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-4 space-y-3.5 text-sm">
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={6}
          required
          placeholder="Paste the full ticket here — the first line becomes the subject."
          className="field font-mono text-xs leading-relaxed"
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input value={requesterName} onChange={(e) => setRequesterName(e.target.value)} placeholder="Requester" className="field" />
          <input value={buildingHint} onChange={(e) => setBuildingHint(e.target.value)} placeholder="Building hint" className="field" />
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" className="field" />
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="submit" disabled={busy || !rawText.trim()} className="btn-primary">
          <Sparkles size={15} />
          {busy ? "Drafting…" : "Draft reply"}
        </button>
      </form>
    </section>
  );
}

function TicketDetail({ ticket, onChanged }: { ticket: Ticket; onChanged: (t: Ticket) => void }) {
  const [busy, setBusy] = useState<"redraft" | "resolve" | "claim" | "send" | null>(null);
  const [resolution, setResolution] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Latest round may hold one draft per model (Claude + GPT). Let the agent
  // flip between them; the chosen one feeds the send composer.
  const generation = latestGeneration(ticket.drafts);
  const [selectedModel, setSelectedModel] = useState<string | null>(generation[0]?.model ?? null);
  useEffect(() => {
    setSelectedModel(latestGeneration(ticket.drafts)[0]?.model ?? null);
  }, [ticket.id, ticket.drafts]);
  const draft = generation.find((d) => d.model === selectedModel) ?? generation[0];

  const badge = ticketBadge(ticket.status);
  const prio = priorityMeta(ticket.priority);
  const sla = slaMeta(ticket.sla);
  const mine = ticket.mine ?? false;
  const manual = ticket.source === "MANUAL";

  async function action(path: string, kind: typeof busy, body: Record<string, unknown> = {}) {
    setBusy(kind);
    setError(null);
    try {
      onChanged(await api<Ticket>(`/tickets/${ticket.id}/${path}`, { method: "POST", body }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function resolve() {
    if (!resolution.trim()) return;
    setBusy("resolve");
    setError(null);
    try {
      const t = await api<Ticket>(`/tickets/${ticket.id}/resolve`, { method: "POST", body: { resolution } });
      setResolution("");
      onChanged(t);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Resolve failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Pill tone={sourceMeta(ticket.source).tone}>{sourceMeta(ticket.source).label}</Pill>
            <Pill tone={prio.tone} dot>{prio.label}</Pill>
            {sla && (
              <Pill tone={sla.tone} dot>
                {sla.tone === "danger" ? <AlertTriangle size={11} /> : <Clock size={11} />}
                {sla.label}
              </Pill>
            )}
            {ticket.externalId && <span className="font-mono text-[11px] text-ink-faint">{ticket.externalId}</span>}
          </div>
          <h2 className="font-display text-lg font-semibold text-ink">{ticket.subject}</h2>
          <div className="mt-0.5 text-xs text-ink-soft">{ticket.category ?? "Uncategorized"}</div>
        </div>
        <Pill tone={badge.tone} dot>{badge.label}</Pill>
      </header>

      {/* Requester + assignment bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper-deep/30 px-5 py-3">
        <div className="flex items-center gap-2 text-xs text-ink-soft">
          <User size={14} className="text-ink-faint" />
          {ticket.requester ? (
            <span>
              <span className="font-medium text-ink">{ticket.requester.fullName}</span>
              {ticket.requester.building?.name ? ` · ${ticket.requester.building.name}` : ""}
              {ticket.requester.email ? ` · ${ticket.requester.email}` : ""}
              <span className="ml-1.5 rounded bg-accent-wash px-1.5 py-0.5 text-[10px] font-medium text-accent">linked</span>
            </span>
          ) : (
            <span className="text-ink-faint">Requester not linked to a staff record</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {ticket.assignedTo ? (
            <span className="flex items-center gap-1.5 text-xs text-ink-soft">
              <UserCheck size={13} className="text-accent" />
              {mine ? "Assigned to you" : `Assigned to ${ticket.assignedTo.name}`}
            </span>
          ) : (
            <span className="text-xs text-ink-faint">Unassigned</span>
          )}
          {!mine ? (
            <button onClick={() => action("assign", "claim")} disabled={busy !== null} className="btn-soft px-2.5 py-1 text-xs">
              <Hand size={12} />
              {busy === "claim" ? "Claiming…" : "Claim"}
            </button>
          ) : (
            <button onClick={() => action("unassign", "claim")} disabled={busy !== null} className="btn-ghost px-2.5 py-1 text-xs">
              Release
            </button>
          )}
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        <Block label="Original">
          <p className="whitespace-pre-wrap text-sm text-ink-soft">{ticket.body}</p>
        </Block>

        {draft ? (
          <>
            {generation.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                  Compare
                </span>
                {generation.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedModel(d.model)}
                    className={cn(
                      "rounded-field px-2.5 py-1 text-xs transition",
                      d.model === draft.model
                        ? "bg-accent-wash font-medium text-accent-ink"
                        : "text-ink-soft hover:bg-paper-deep/50",
                    )}
                  >
                    <Sparkles size={11} className="mr-1 inline" />
                    {modelLabel(d.model)}
                  </button>
                ))}
              </div>
            )}
            <Block label={`Suggested reply${generation.length > 1 ? ` · ${modelLabel(draft.model)}` : ""}`}>
              <p className="whitespace-pre-wrap rounded-field border border-line bg-paper-deep/30 p-3.5 text-sm leading-relaxed text-ink">
                {draft.suggestedReply}
              </p>
            </Block>
            {draft.suggestedNote && (
              <Block label="Internal note">
                <p className="whitespace-pre-wrap rounded-field border border-honey/25 bg-honey-wash p-3.5 text-sm text-honey">
                  {draft.suggestedNote}
                </p>
              </Block>
            )}
            <Block label={`Retrieved context${draft.model ? ` · ${draft.model}` : ""}`}>
              {draft.retrievedContext && draft.retrievedContext.length > 0 ? (
                <ul className="space-y-1.5">
                  {draft.retrievedContext.map((c, i) => (
                    <li key={i} className="flex gap-2.5 rounded-field border border-line bg-surface-raised p-2.5 text-xs text-ink-soft">
                      <span className="shrink-0 rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-soft">
                        {c.type} · {Math.round(c.score * 100)}%
                      </span>
                      <span className="leading-relaxed">{c.snippet}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-faint">No prior memory matched. Resolve tickets and reindex KB to grow recall.</p>
              )}
            </Block>
          </>
        ) : (
          <p className="text-sm text-ink-soft">No draft yet.</p>
        )}

        {/* Sent replies */}
        {ticket.replies && ticket.replies.length > 0 && (
          <Block label={`Sent (${ticket.replies.length})`}>
            <ul className="space-y-2">
              {ticket.replies.map((r) => (
                <li key={r.id} className="rounded-field border border-line bg-surface-raised p-3 text-xs">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] text-ink-faint">
                    <Send size={11} />
                    <span className="font-medium text-ink-soft">{r.user?.name ?? "Agent"}</span>
                    <span>· {new Date(r.createdAt).toLocaleString()}</span>
                    <span className={cn(
                      "rounded px-1.5 py-0.5 font-medium",
                      r.delivered ? "bg-accent-wash text-accent" : "bg-paper-deep text-ink-faint",
                    )}>
                      {r.mode === "sandbox" ? "sandbox" : "sent"}{r.delivered ? " · delivered" : ""}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-ink-soft">{r.body}</p>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        {/* Send composer */}
        {ticket.status !== "RESOLVED" && (
          <SendComposer
            ticketId={ticket.id}
            source={ticket.source}
            mine={mine}
            manual={manual}
            initialReply={draft?.suggestedReply ?? ""}
            initialNote={draft?.suggestedNote ?? ""}
            busy={busy === "send"}
            onSend={async (body, internalNote) => {
              setBusy("send");
              setError(null);
              try {
                onChanged(await api<Ticket>(`/tickets/${ticket.id}/send`, { method: "POST", body: { body, internalNote: internalNote || undefined } }));
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Send failed");
              } finally {
                setBusy(null);
              }
            }}
          />
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button onClick={() => action("redraft", "redraft")} disabled={busy !== null} className="btn-ghost px-3 py-1.5 text-xs">
            <RefreshCw size={13} className={busy === "redraft" ? "animate-spin" : ""} />
            {busy === "redraft" ? "Redrafting…" : "Redraft"}
          </button>
          {ticket.status !== "RESOLVED" && (
            <div className="flex flex-1 items-center gap-2">
              <input
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Resolution summary → remembered for future tickets"
                className="field-sm flex-1"
              />
              <button onClick={resolve} disabled={busy !== null || !resolution.trim()} className="btn-primary px-3 py-1.5 text-xs">
                {busy === "resolve" ? "…" : "Resolve"}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SendComposer({
  ticketId,
  source,
  mine,
  manual,
  initialReply,
  initialNote,
  busy,
  onSend,
}: {
  ticketId: string;
  source: string;
  mine: boolean;
  manual: boolean;
  initialReply: string;
  initialNote: string;
  busy: boolean;
  onSend: (body: string, internalNote: string) => void;
}) {
  const [body, setBody] = useState(initialReply);
  const [note, setNote] = useState(initialNote);

  // Re-seed when switching ticket or after a fresh redraft.
  useEffect(() => { setBody(initialReply); }, [ticketId, initialReply]);
  useEffect(() => { setNote(initialNote); }, [ticketId, initialNote]);

  const channel = sourceMeta(source).label;

  return (
    <Block label="Reply & send">
      <div className="rounded-field border border-line bg-surface-raised p-3.5">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Edit the reply, then send it back to the requester."
          className="field text-sm leading-relaxed"
        />
        {source === "SERVICENOW" && (
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Internal work note (optional)"
            className="field-sm mt-2"
          />
        )}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <p className="text-[11px] text-ink-faint">
            {manual
              ? "Manual ticket — recorded, no external channel."
              : !mine
                ? "Claim this ticket to enable sending."
                : `Sends as you via ${channel}. You review, you send — never auto-sent.`}
          </p>
          <button
            onClick={() => onSend(body, note)}
            disabled={busy || !body.trim() || (!mine && !manual)}
            className="btn-primary px-3 py-1.5 text-xs"
            title={!mine && !manual ? "Claim the ticket first" : undefined}
          >
            <Send size={13} />
            {busy ? "Sending…" : manual ? "Record reply" : `Send via ${channel}`}
          </button>
        </div>
      </div>
    </Block>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
      {children}
    </div>
  );
}

function Queue({
  queue,
  filter,
  onFilter,
  selectedId,
  onSelect,
  onReindex,
}: {
  queue: QueueResponse | null;
  filter: "all" | "mine" | "unassigned";
  onFilter: (f: "all" | "mine" | "unassigned") => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReindex: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function reindex() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ indexed: number }>("/tickets/reindex-kb", { method: "POST", body: {} });
      setMsg(`Indexed ${res.indexed} KB articles`);
      await onReindex();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Reindex failed");
    } finally {
      setBusy(false);
    }
  }

  const counts = queue?.counts;
  const items = (queue?.items ?? []).filter((t) =>
    filter === "unassigned" ? !t.assignedTo && t.status !== "RESOLVED" : true,
  );

  return (
    <section className="panel h-fit overflow-hidden">
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="flex items-baseline gap-2 text-[15px] font-semibold text-ink">
          Queue
          {counts && <span className="font-mono text-xs font-normal text-ink-faint">{counts.open} open</span>}
        </h2>
        <button onClick={reindex} disabled={busy} className="btn-ghost px-2.5 py-1 text-xs">
          <BookOpen size={13} />
          {busy ? "…" : "Reindex KB"}
        </button>
      </header>

      {counts && (counts.breached > 0 || counts.atRisk > 0) && (
        <div className="flex items-center gap-2 border-b border-line bg-clay-wash/40 px-5 py-2 text-xs">
          {counts.breached > 0 && (
            <span className="flex items-center gap-1 font-medium text-clay">
              <AlertTriangle size={12} /> {counts.breached} past SLA
            </span>
          )}
          {counts.atRisk > 0 && (
            <span className="flex items-center gap-1 text-honey">
              <Clock size={12} /> {counts.atRisk} due soon
            </span>
          )}
        </div>
      )}

      <div className="flex gap-1 border-b border-line px-3 py-2">
        {([
          ["all", `All${counts ? ` ${counts.total}` : ""}`],
          ["mine", `Mine${counts ? ` ${counts.mine}` : ""}`],
          ["unassigned", `Unassigned${counts ? ` ${counts.unassigned}` : ""}`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => onFilter(key)}
            className={cn(
              "rounded-field px-2.5 py-1 text-xs transition",
              filter === key ? "bg-accent-wash font-medium text-accent-ink" : "text-ink-soft hover:bg-paper-deep/50",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {msg && <div className="border-b border-line px-5 py-2 text-xs text-ink-soft">{msg}</div>}

      {items.length === 0 ? (
        <EmptyState title="Nothing here" hint="Paste a ticket on the left, or sync a source from Connections." />
      ) : (
        <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
          {items.map((t) => {
            const sla = slaMeta(t.sla);
            const prio = priorityMeta(t.priority);
            return (
              <li key={t.id}>
                <button
                  onClick={() => onSelect(t.id)}
                  className={cn(
                    "block w-full px-5 py-3 text-left transition hover:bg-paper-deep/40",
                    selectedId === t.id && "bg-accent-wash/50",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink">{t.subject}</span>
                    {sla && (sla.tone === "danger" || sla.tone === "warn") && (
                      <Pill tone={sla.tone}>{sla.label}</Pill>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Pill tone={prio.tone}>{prio.label}</Pill>
                    <Pill tone={sourceMeta(t.source).tone}>{sourceMeta(t.source).label}</Pill>
                    {t.mine && <span className="rounded bg-accent-wash px-1.5 py-0.5 text-[10px] font-medium text-accent">mine</span>}
                    <span className="truncate text-xs text-ink-faint">
                      {t.requester?.fullName ?? "Unlinked"}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
