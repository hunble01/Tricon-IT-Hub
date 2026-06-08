import { TicketPriority, TicketStatus } from "@prisma/client";

/**
 * Phase 2 — keyless ticket policy: auto-prioritization + SLA windows.
 * Pure functions (no DI) so both the drafter and the source-sync path apply the
 * same rules. When a real LLM key lands, prioritization can be upgraded behind
 * the same call site without touching callers.
 */

const URGENT_HINTS = [
  "down", "outage", "can't work", "cannot work", "all staff", "everyone",
  "urgent", "asap", "critical", "locked out", "security", "breach", "phishing",
];
const HIGH_HINTS = [
  "can't log", "cannot log", "won't connect", "not working", "broken", "no internet",
  "password", "email down", "printer down", "front desk", "leasing office",
];
const LOW_HINTS = [
  "request", "would like", "nice to have", "when you get a chance", "whenever",
  "second monitor", "spare", "question about",
];

/** Heuristic priority from the ticket text. Conservative: defaults to NORMAL. */
export function autoPrioritize(
  subject: string,
  body: string,
  fallback: TicketPriority = TicketPriority.NORMAL,
): TicketPriority {
  const text = `${subject} ${body}`.toLowerCase();
  if (URGENT_HINTS.some((h) => text.includes(h))) return TicketPriority.URGENT;
  if (HIGH_HINTS.some((h) => text.includes(h))) return TicketPriority.HIGH;
  if (LOW_HINTS.some((h) => text.includes(h))) return TicketPriority.LOW;
  return fallback;
}

/** SLA response windows in hours, by priority. */
export const SLA_HOURS: Record<TicketPriority, number> = {
  URGENT: 4,
  HIGH: 8,
  NORMAL: 24,
  LOW: 72,
};

/** When a reply is due, given a priority and a start time. */
export function slaDueFor(priority: TicketPriority, from: Date): Date {
  return new Date(from.getTime() + SLA_HOURS[priority] * 60 * 60 * 1000);
}

export type SlaState = "on_track" | "at_risk" | "breached" | "met" | "none";

export interface SlaView {
  state: SlaState;
  dueAt: Date | null;
  hoursLeft: number | null;
}

/**
 * Where a ticket stands against its SLA right now.
 *   resolved              → "met" (or "none" if it never had a due date)
 *   past due              → "breached"
 *   ≤ 25% of window left  → "at_risk"
 *   otherwise             → "on_track"
 */
export function slaState(
  ticket: { status: TicketStatus; priority: TicketPriority; slaDueAt: Date | null; createdAt: Date },
  now: Date = new Date(),
): SlaView {
  if (!ticket.slaDueAt) {
    return { state: ticket.status === TicketStatus.RESOLVED ? "met" : "none", dueAt: null, hoursLeft: null };
  }
  const due = ticket.slaDueAt;
  const hoursLeft = (due.getTime() - now.getTime()) / (60 * 60 * 1000);
  if (ticket.status === TicketStatus.RESOLVED) {
    return { state: "met", dueAt: due, hoursLeft };
  }
  if (now >= due) return { state: "breached", dueAt: due, hoursLeft };
  const window = SLA_HOURS[ticket.priority];
  if (hoursLeft <= window * 0.25) return { state: "at_risk", dueAt: due, hoursLeft };
  return { state: "on_track", dueAt: due, hoursLeft };
}
