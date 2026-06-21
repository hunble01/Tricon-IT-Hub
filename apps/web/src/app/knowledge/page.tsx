"use client";

import { useEffect, useState } from "react";
import { BookOpen, Sparkles, Save, X, Loader2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, ErrorNote, EmptyState } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

interface Article { id: string; title: string; content: string; tags: string[]; source: string | null; createdAt: string }
interface Ticket { id: string; subject: string; status: string }
interface Draft { title: string; content: string; tags: string[]; sourceTicketId: string }

export default function KnowledgePage() {
  return (
    <AppShell eyebrow="Intelligence" title="Knowledge Base">
      {() => <Knowledge />}
    </AppShell>
  );
}

function Knowledge() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [resolved, setResolved] = useState<Ticket[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [a, tickets] = await Promise.all([
        api<Article[]>("/knowledge"),
        api<Ticket[]>("/tickets"),
      ]);
      setArticles(a);
      setResolved(tickets.filter((t) => t.status === "RESOLVED"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load");
    }
  }
  useEffect(() => { void refresh(); }, []);

  return (
    <div className="space-y-5">
      {error && <ErrorNote>{error}</ErrorNote>}
      <Generator resolved={resolved} onSaved={refresh} />

      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold text-ink">Articles</h2>
        <span className="font-mono text-xs text-ink-faint">{articles.length}</span>
      </div>
      {articles.length === 0 ? (
        <div className="panel">
          <EmptyState icon={<BookOpen size={20} />} title="No articles yet" hint="Generate one from a resolved ticket above — it gets indexed into AI memory so Ask the Hub can use it." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {articles.map((a) => (
            <article key={a.id} className="panel p-4">
              <h3 className="text-sm font-semibold text-ink">{a.title}</h3>
              <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs leading-snug text-ink-soft">{a.content}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {a.source && <Pill tone="info">{a.source}</Pill>}
                {a.tags.slice(0, 4).map((t) => <Pill key={t} tone="neutral">{t}</Pill>)}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Generator({ resolved, onSaved }: { resolved: Ticket[]; onSaved: () => void }) {
  const [ticketId, setTicketId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!ticketId) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      setDraft(await api<Draft>("/knowledge/generate", { method: "POST", body: { ticketId } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to generate");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await api("/knowledge", {
        method: "POST",
        body: { title: draft.title, content: draft.content, tags: draft.tags, sourceTicketId: draft.sourceTicketId },
      });
      setDraft(null);
      setTicketId("");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-accent" />
        <p className="text-sm font-medium text-ink">Generate an article from a resolved ticket</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={ticketId} onChange={(e) => setTicketId(e.target.value)} className="field-sm min-w-[260px] flex-1">
          <option value="">Select a resolved ticket…</option>
          {resolved.map((t) => <option key={t.id} value={t.id}>{t.subject}</option>)}
        </select>
        <button type="button" onClick={generate} disabled={busy || !ticketId} className="btn-primary">
          {busy && !draft ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Draft
        </button>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {draft && (
        <div className="space-y-2 rounded-card border border-line bg-paper-deep/20 p-3">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="field w-full font-semibold"
          />
          <textarea
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            rows={8}
            className="field w-full resize-y font-mono text-xs"
          />
          <input
            value={draft.tags.join(", ")}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="tags, comma separated"
            className="field-sm w-full"
          />
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="btn-ghost">
              <X size={15} /> Discard
            </button>
            <button type="button" onClick={save} disabled={busy} className="btn-primary">
              <Save size={15} /> Save to KB
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
