"use client";

import { useState } from "react";
import { Sparkles, CornerDownLeft, Loader2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ErrorNote } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

type ChatResponse =
  | { type: "message"; text: string; steps: Array<{ tool: string }> }
  | { type: "proposal"; tool: string; args: Record<string, unknown>; summary: string; steps: Array<{ tool: string }> };

const EXAMPLES = [
  "How many laptops are in stock right now?",
  "What did we do last time someone couldn't connect to the office WiFi?",
  "Which staff are onboarding this month?",
  "What's the total value of our device fleet?",
  "How do we usually fix uniFLOW secure-print problems?",
];

export default function AskPage() {
  return (
    <AppShell eyebrow="Intelligence" title="Ask the Hub">
      {() => <Ask />}
    </AppShell>
  );
}

function Ask() {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [tools, setTools] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setAsked(text);
    setAnswer(null);
    setTools([]);
    setQ("");
    try {
      const res = await api<ChatResponse>("/assistant/chat", {
        method: "POST",
        body: { messages: [{ role: "user", content: text }] },
      });
      setTools((res.steps ?? []).map((s) => s.tool));
      setAnswer(res.type === "message" ? res.text : res.summary);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="panel p-5">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-accent" />
          <p className="text-sm text-ink-soft">
            Ask anything about your staff, devices, tickets, history, or tasks — in plain English.
          </p>
        </div>
        <div className="mt-4 flex items-end gap-2">
          <textarea
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(q);
              }
            }}
            rows={2}
            placeholder="e.g. Which staff at The Taylor don't have a laptop yet?"
            className="field flex-1 resize-none"
          />
          <button
            type="button"
            onClick={() => void ask(q)}
            disabled={busy || !q.trim()}
            className="btn-primary h-[42px]"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <CornerDownLeft size={16} />}
            Ask
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => void ask(ex)}
              disabled={busy}
              className="rounded-full border border-line bg-surface-raised px-3 py-1 text-xs text-ink-soft transition hover:border-accent-bright hover:text-ink disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {asked && (
        <div className="panel p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">You asked</p>
          <p className="mt-1 text-sm font-medium text-ink">{asked}</p>
          <div className="mt-4 border-t border-line pt-4">
            {busy && !answer ? (
              <p className="flex items-center gap-2 text-sm text-ink-soft">
                <Loader2 size={15} className="animate-spin" /> Thinking…
              </p>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{answer}</p>
            )}
            {tools.length > 0 && (
              <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                via {tools.join(" · ")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
