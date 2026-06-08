"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ticket, Mail, MessageSquare, FileText, Check, Eye, Send, RefreshCw, FlaskConical, Plug, type LucideIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, type Tone } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type ConnStatus = "active" | "not_configured" | "deferred";

type ConnMode = "live" | "sandbox" | "off";

interface Connection {
  id: string;
  name: string;
  kind: "TICKET" | "EMAIL" | "CHAT";
  role: string;
  status: ConnStatus;
  mode: ConnMode;
  canSync: boolean;
  canSend: boolean;
  phase: string;
  summary: string;
  capabilities: { read: boolean; send: boolean };
  scopes: string[];
  identity: string;
  connectHint?: string;
}

interface SyncResult { mode: ConnMode; synced: number; created: number; updated: number; enriched?: number }
interface ConnectResult { ready: boolean; mode: ConnMode; message: string; nextStep: string }

const ICONS: Record<string, LucideIcon> = {
  manual: FileText,
  servicenow: Ticket,
  outlook: Mail,
  teams: MessageSquare,
};

const STATUS: Record<ConnStatus, { tone: Tone; label: string }> = {
  active: { tone: "success", label: "Connected" },
  not_configured: { tone: "warn", label: "Not connected" },
  deferred: { tone: "neutral", label: "Deferred" },
};

export default function ConnectionsPage() {
  return (
    <AppShell eyebrow="Integrations" title="Connections">
      {() => <Connections />}
    </AppShell>
  );
}

function Connections() {
  const [conns, setConns] = useState<Connection[]>([]);

  useEffect(() => {
    api<Connection[]>("/connections").then(setConns).catch(() => setConns([]));
  }, []);

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-ink-soft">
        Where the hub gets its tickets and email. Today it works from paste-in; ServiceNow and Outlook
        plug in for Phase 2 — read-only first, sending later, and always as the signed-in agent.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {conns.map((c) => (
          <ConnectionCard key={c.id} c={c} />
        ))}
      </div>

      <Principles />
    </div>
  );
}

function ConnectionCard({ c }: { c: Connection }) {
  const Icon = ICONS[c.id] ?? FileText;
  const status = STATUS[c.status];
  const dim = c.status !== "active";
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      setResult(await api<SyncResult>(`/connections/${c.id}/sync`, { method: "POST", body: {} }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function connect() {
    setConnecting(true);
    setConnectMsg(null);
    try {
      const res = await api<ConnectResult>(`/connections/${c.id}/connect`, { method: "POST", body: {} });
      setConnectMsg(res.message);
    } catch (err) {
      setConnectMsg(err instanceof ApiError ? err.message : "Connect failed");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <section className={cn("panel p-5", dim && "opacity-95")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex h-10 w-10 items-center justify-center rounded-[11px]",
            c.status === "active" ? "bg-accent text-white" : "bg-paper-deep text-ink-soft",
          )}>
            <Icon size={18} />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{c.name}</h2>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
              {c.role} · {c.kind.toLowerCase()} · {c.phase}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Pill tone={status.tone} dot>{status.label}</Pill>
          {c.mode === "sandbox" && c.canSync && (
            <span className="inline-flex items-center gap-1 rounded-full bg-honey-wash px-2 py-0.5 text-[10px] font-medium text-honey">
              <FlaskConical size={10} /> Sandbox data
            </span>
          )}
          {c.mode === "live" && c.id !== "manual" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-wash px-2 py-0.5 text-[10px] font-medium text-accent">
              <Check size={10} /> Live
            </span>
          )}
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{c.summary}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <CapChip on={c.capabilities.read} icon={<Eye size={12} />} label="Read" />
        <CapChip
          on={c.capabilities.send}
          icon={<Send size={12} />}
          label="Send"
          soon={c.canSend && c.mode === "sandbox" ? false : !c.capabilities.send && c.kind !== "CHAT"}
          note={c.canSend && c.mode === "sandbox" ? "sandbox" : undefined}
        />
        {c.identity !== "—" && (
          <span className="ml-auto text-[11px] text-ink-faint">{c.identity}</span>
        )}
      </div>

      {c.scopes.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">Access needed</div>
          <div className="flex flex-wrap gap-1.5">
            {c.scopes.map((s) => (
              <span key={s} className="rounded-full bg-paper-deep px-2 py-0.5 font-mono text-[10.5px] text-ink-soft">{s}</span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {c.id === "manual" ? (
          <Link href="/tickets" className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
            <Check size={14} /> Open the ticket drafter
          </Link>
        ) : c.canSync ? (
          <>
            <button onClick={sync} disabled={syncing} className="btn-primary px-3 py-1.5 text-xs">
              <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            {c.status !== "active" && (
              <button onClick={connect} disabled={connecting} className="btn-soft px-3 py-1.5 text-xs">
                <Plug size={13} />
                {connecting ? "…" : "Connect"}
              </button>
            )}
            {result && (
              <Link href="/tickets" className="text-xs text-ink-soft hover:text-ink hover:underline">
                Pulled {result.synced} ({result.created} new{result.enriched ? `, ${result.enriched} linked` : ""}) → view in Tickets
              </Link>
            )}
            {error && <span className="text-xs text-clay">{error}</span>}
          </>
        ) : (
          <span className="text-xs text-ink-faint">Not planned for now.</span>
        )}
      </div>
      {connectMsg && (
        <p className="mt-2 rounded-field border border-line bg-paper-deep/40 px-2.5 py-2 text-[11px] text-ink-soft">
          {connectMsg}
        </p>
      )}
      {c.mode === "sandbox" && c.canSync && !result && (
        <p className="mt-2 text-[11px] text-ink-faint">
          Pulls clearly-labelled sample {c.kind === "EMAIL" ? "emails" : "tickets"}. Set this source&apos;s
          credentials in <code className="font-mono">.env</code> to go live.
        </p>
      )}
    </section>
  );
}

function CapChip({ on, icon, label, soon, note }: { on: boolean; icon: React.ReactNode; label: string; soon?: boolean; note?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
      on ? "bg-accent-wash text-accent-ink" : "bg-paper-deep text-ink-faint",
    )}>
      {icon}
      {label}
      {note && <span className="text-ink-faint">· {note}</span>}
      {soon && <span className="text-ink-faint">· later</span>}
    </span>
  );
}

function Principles() {
  const items = [
    { title: "Knowledge is shared, actions are owned", body: "Every resolution feeds one team memory + KB, so the whole team gets smarter — but each agent only acts on their own tickets and inbox." },
    { title: "Read first, send later", body: "Connections start read-only. Sending replies is a separate, higher-trust step granted afterward." },
    { title: "Human-in-the-loop", body: "The AI drafts; you review and press Send. Nothing is ever sent automatically." },
  ];
  return (
    <section className="rounded-card border border-line bg-surface-raised p-5 shadow-soft">
      <h2 className="text-[13px] font-semibold text-ink">How connections behave</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.title}>
            <div className="text-[13px] font-medium text-accent-ink">{it.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
