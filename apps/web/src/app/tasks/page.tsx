"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, CalendarClock, CalendarPlus, Plus, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, ErrorNote, type Tone } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type Status = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
type Source = "MANUAL" | "ONBOARDING" | "OFFBOARDING" | "TICKET" | "INTAKE" | "ASSISTANT";

const TYPES = [
  "INSTALL", "ASSIGN_DEVICE", "RETURN_DEVICE", "REPAIR", "SETUP",
  "ACCESS", "PROCUREMENT", "AUDIT", "ONBOARDING", "OFFBOARDING", "OTHER",
] as const;
type TaskType = (typeof TYPES)[number];

interface Task {
  id: string;
  title: string;
  description: string | null;
  type: TaskType;
  status: Status;
  priority: Priority;
  source: Source;
  dueDate: string | null;
  overdue: boolean;
  calendarEventId: string | null;
  staff: { id: string; fullName: string } | null;
  device: { id: string; type: string; model: string | null; assetTag: string | null } | null;
  building: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
}

interface Stats {
  byStatus: Record<string, number>;
  open: number;
  overdue: number;
  total: number;
}

const COLUMNS: { status: Status; label: string; tone: Tone }[] = [
  { status: "TODO", label: "To do", tone: "neutral" },
  { status: "IN_PROGRESS", label: "In progress", tone: "info" },
  { status: "BLOCKED", label: "Blocked", tone: "warn" },
  { status: "DONE", label: "Done", tone: "success" },
];

const TYPE_LABEL: Record<TaskType, string> = {
  INSTALL: "Install", ASSIGN_DEVICE: "Assign device", RETURN_DEVICE: "Return device",
  REPAIR: "Repair", SETUP: "Setup", ACCESS: "Access", PROCUREMENT: "Procurement",
  AUDIT: "Audit", ONBOARDING: "Onboarding", OFFBOARDING: "Offboarding", OTHER: "Other",
};

function sourceTone(s: Source): Tone {
  return s === "MANUAL" ? "neutral"
    : s === "TICKET" ? "accent"
    : s === "ASSISTANT" ? "info"
    : "warn";
}

function priorityTone(p: Priority): Tone {
  return p === "URGENT" ? "danger" : p === "HIGH" ? "warn" : p === "LOW" ? "neutral" : "info";
}

function fmtDue(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function TasksPage() {
  return (
    <AppShell eyebrow="Operations" title="Tasks">
      {() => <TasksBoard />}
    </AppShell>
  );
}

function TasksBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filterType, setFilterType] = useState<string>("");
  const [filterSource, setFilterSource] = useState<string>("");

  async function refresh() {
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (filterType) qs.set("type", filterType);
      if (filterSource) qs.set("source", filterSource);
      const [t, s] = await Promise.all([
        api<Task[]>(`/tasks${qs.toString() ? `?${qs}` : ""}`),
        api<Stats>("/tasks/stats"),
      ]);
      setTasks(t);
      setStats(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [filterType, filterSource]);

  const byStatus = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const c of COLUMNS) map[c.status] = [];
    for (const t of tasks) (map[t.status] ??= []).push(t);
    return map;
  }, [tasks]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-sm text-ink-soft">
          <span><span className="numeral mr-1 text-lg font-semibold text-ink">{stats?.open ?? 0}</span> open</span>
          {!!stats?.overdue && (
            <span className="flex items-center gap-1 text-clay">
              <CalendarClock size={15} />
              <span className="numeral font-semibold">{stats.overdue}</span> overdue
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="field-sm">
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} className="field-sm">
            <option value="">All sources</option>
            {["MANUAL", "ONBOARDING", "OFFBOARDING", "TICKET", "INTAKE", "ASSISTANT"].map((s) => (
              <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
            ))}
          </select>
          <button type="button" onClick={() => setShowCreate((v) => !v)} className="btn-primary">
            {showCreate ? <X size={15} /> : <Plus size={15} />}
            {showCreate ? "Close" : "New task"}
          </button>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {showCreate && <CreateTaskForm onCreated={() => { setShowCreate(false); void refresh(); }} />}

      {loading ? (
        <div className="panel px-5 py-12 text-center text-sm text-ink-soft">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col, i) => (
            <div key={col.status} className="stagger min-w-0" style={{ ["--i" as string]: i }}>
              <div className="mb-2.5 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <Pill tone={col.tone} dot>{col.label}</Pill>
                </div>
                <span className="font-mono text-[11px] text-ink-faint">{byStatus[col.status]?.length ?? 0}</span>
              </div>
              <div className="space-y-2.5">
                {(byStatus[col.status] ?? []).map((t) => (
                  <TaskCard key={t.id} task={t} onChange={refresh} />
                ))}
                {(byStatus[col.status]?.length ?? 0) === 0 && (
                  <div className="rounded-card border border-dashed border-line px-3 py-6 text-center text-xs text-ink-faint">
                    Nothing here
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, onChange }: { task: Task; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api(`/tasks/${task.id}`, { method: "PATCH", body });
      onChange();
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(`/tasks/${task.id}`, { method: "DELETE" });
      onChange();
    } finally {
      setBusy(false);
    }
  }
  async function addToCalendar() {
    setBusy(true);
    try {
      await api(`/tasks/${task.id}/calendar`, { method: "POST" });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("panel space-y-2 p-3 transition", busy && "opacity-50")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium leading-snug text-ink">{task.title}</p>
        <button
          type="button"
          onClick={remove}
          title="Delete task"
          className="shrink-0 text-ink-faint transition hover:text-clay"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {task.description && <p className="text-xs leading-snug text-ink-soft">{task.description}</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone="neutral">{TYPE_LABEL[task.type]}</Pill>
        {task.priority !== "NORMAL" && <Pill tone={priorityTone(task.priority)}>{task.priority.toLowerCase()}</Pill>}
        {task.source !== "MANUAL" && <Pill tone={sourceTone(task.source)}>{task.source.toLowerCase()}</Pill>}
        {task.dueDate && (
          <Pill tone={task.overdue ? "danger" : "neutral"}>
            <CalendarClock size={11} /> {fmtDue(task.dueDate)}
          </Pill>
        )}
      </div>

      {(task.staff || task.building || task.device) && (
        <p className="text-[11px] text-ink-faint">
          {[task.staff?.fullName, task.building?.name,
            task.device && `${task.device.type}${task.device.assetTag ? ` ${task.device.assetTag}` : ""}`]
            .filter(Boolean).join(" · ")}
        </p>
      )}

      <div className="flex items-center gap-1.5 pt-0.5">
        <select
          value={task.status}
          disabled={busy}
          onChange={(e) => patch({ status: e.target.value })}
          className="field-sm flex-1"
        >
          <option value="TODO">To do</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="BLOCKED">Blocked</option>
          <option value="DONE">Done</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        {task.dueDate && (
          task.calendarEventId ? (
            <span
              title="On your calendar"
              className="flex h-7 w-7 items-center justify-center rounded-[8px] text-accent"
            >
              <CalendarCheck size={15} />
            </span>
          ) : (
            <button
              type="button"
              onClick={addToCalendar}
              disabled={busy}
              title="Add to calendar"
              className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-line text-ink-soft transition hover:bg-paper-deep"
            >
              <CalendarPlus size={15} />
            </button>
          )
        )}
      </div>
    </div>
  );
}

function CreateTaskForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("OTHER");
  const [priority, setPriority] = useState<Priority>("NORMAL");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("/tasks", {
        method: "POST",
        body: {
          title: title.trim(),
          type,
          priority,
          description: description.trim() || undefined,
          dueDate: dueDate || undefined,
        },
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create task");
      setBusy(false);
    }
  }

  return (
    <div className="panel space-y-3 p-4">
      {error && <ErrorNote>{error}</ErrorNote>}
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What needs doing? (e.g. Install monitor at 100 King)"
        className="field w-full"
        onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Details (optional)"
        rows={2}
        className="field w-full resize-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select value={type} onChange={(e) => setType(e.target.value as TaskType)} className="field-sm">
          {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="field-sm">
          {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => (
            <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>
          ))}
        </select>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="field-sm" />
        <button type="button" disabled={busy || !title.trim()} onClick={submit} className="btn-primary ml-auto">
          {busy ? "Adding…" : "Add task"}
        </button>
      </div>
    </div>
  );
}
