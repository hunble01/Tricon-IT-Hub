"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Check, Mic, Send, Sparkles, Square, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getToken } from "@/lib/session";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type Role = "user" | "assistant";
interface ChatMessage {
  role: Role;
  content: string;
  proposal?: { tool: string; args: Record<string, unknown> };
  done?: boolean; // proposal acted on
}

type ChatResponse =
  | { type: "message"; text: string }
  | { type: "proposal"; tool: string; args: Record<string, unknown>; summary: string };

export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!open) return;
    api<{ voice: boolean }>("/assistant/capabilities")
      .then((c) => setVoiceOn(c.voice))
      .catch(() => setVoiceOn(false));
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await api<ChatResponse>("/assistant/chat", {
        method: "POST",
        body: { messages: next.map((m) => ({ role: m.role, content: m.content })) },
      });
      if (res.type === "proposal") {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: res.summary, proposal: { tool: res.tool, args: res.args } },
        ]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: res.text }]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Assistant request failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmProposal(index: number) {
    const msg = messages[index];
    if (!msg?.proposal) return;
    setBusy(true);
    setError(null);
    try {
      await api("/assistant/act", { method: "POST", body: msg.proposal });
      setMessages((m) => m.map((x, i) => (i === index ? { ...x, done: true } : x)));
      setMessages((m) => [...m, { role: "assistant", content: "Done — that's applied. ✅" }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function cancelProposal(index: number) {
    setMessages((m) => m.map((x, i) => (i === index ? { ...x, done: true } : x)));
    setMessages((m) => [...m, { role: "assistant", content: "Okay, cancelled." }]);
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        await transcribe(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError("Couldn't access the microphone.");
    }
  }

  async function transcribe(blob: Blob) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", blob, "command.webm");
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/assistant/transcribe`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || "Transcription failed");
      }
      const { text } = (await res.json()) as { text: string };
      setInput((prev) => (prev ? `${prev} ${text}` : text));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-card transition hover:bg-accent-bright active:translate-y-px"
        aria-label="Open assistant"
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-50 flex h-[560px] max-h-[80vh] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent text-white">
              <Bot size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink">Hub Assistant</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                Acts through audited tools
              </p>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="rounded-card border border-dashed border-line px-3 py-6 text-center text-xs text-ink-soft">
                Ask me to do something — “create a task to set up the new manager at 100 King”,
                “how many laptops are in stock?”, or “start offboarding for Jane Doe”.
                <br />
                I’ll confirm with you before changing anything.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-card px-3 py-2 text-[13px] leading-snug",
                    m.role === "user" ? "bg-accent text-white" : "bg-paper-deep/60 text-ink",
                  )}
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.proposal && !m.done && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => confirmProposal(i)}
                        className="inline-flex items-center gap-1 rounded-field bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-50"
                      >
                        <Check size={13} /> Confirm
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => cancelProposal(i)}
                        className="rounded-field border border-line px-2.5 py-1 text-xs text-ink-soft hover:bg-paper-deep"
                      >
                        Cancel
                      </button>
                      <code className="ml-auto font-mono text-[10px] text-ink-faint">{m.proposal.tool}</code>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && <p className="text-xs text-ink-faint">Thinking…</p>}
            {error && <p className="rounded-field bg-clay-wash px-2 py-1 text-xs text-clay">{error}</p>}
          </div>

          <div className="border-t border-line p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                placeholder={recording ? "Listening…" : "Tell me what to do…"}
                className="field max-h-28 min-h-[40px] flex-1 resize-none"
              />
              {voiceOn && (
                <button
                  type="button"
                  onClick={toggleRecording}
                  disabled={busy && !recording}
                  title={recording ? "Stop recording" : "Speak a command"}
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-field border transition",
                    recording
                      ? "border-clay/40 bg-clay-wash text-clay"
                      : "border-line text-ink-soft hover:bg-paper-deep",
                  )}
                >
                  {recording ? <Square size={16} /> : <Mic size={16} />}
                </button>
              )}
              <button
                type="button"
                onClick={() => void send(input)}
                disabled={busy || !input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-field bg-accent text-white hover:bg-accent-bright disabled:opacity-50"
                aria-label="Send"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
