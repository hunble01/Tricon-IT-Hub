/**
 * Neutral ticket model + source adapter contract.
 *
 * Updates §1: the ticket adapter is generalized into a SourceAdapter covering
 * tickets AND email (chat stubbed). The drafting/memory engine depends only on
 * this contract + the neutral Ticket shape, never on a vendor.
 *
 * Phase 1 ships ManualAdapter (paste-in). Later: ServiceNowAdapter (REST Table
 * API) + OutlookAdapter (MS Graph). Per §5 these are delegated, per-agent — so
 * ingest() carries the acting agent's identity/credentials per request.
 */

export type NeutralTicketSource = "MANUAL" | "ZENDESK" | "SERVICENOW" | "OUTLOOK";
/** Broader source set the adapter layer may report (incl. chat sources). */
export type NeutralSource = NeutralTicketSource | "TEAMS";
export type NeutralSourceKind = "TICKET" | "EMAIL" | "CHAT";

export type NeutralTicketStatus = "OPEN" | "PENDING" | "RESOLVED";
export type NeutralTicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export interface NeutralRequester {
  externalId?: string;
  email?: string;
  fullName?: string;
  buildingHint?: string;
}

export interface NeutralTicket {
  source: NeutralTicketSource;
  externalId?: string;
  subject: string;
  body: string;
  status?: NeutralTicketStatus;
  priority?: NeutralTicketPriority;
  category?: string;
  requester?: NeutralRequester;
  raw?: unknown;
  createdAt?: Date;
  lastReplyAt?: Date;
}

/**
 * Updates §5 — the acting IT agent's delegated identity/credentials, passed per
 * request so live connectors (Graph token, ServiceNow session) act AS the agent
 * (own inbox / assigned tickets), never tenant-wide. Opaque here; concrete
 * adapters narrow `credentials` to their own shape.
 */
export interface AgentContext {
  userId: string;
  credentials?: Record<string, unknown>;
}

/**
 * Updates §5 — a human-in-the-loop reply pushed back to the source as the
 * acting agent. Send is real (or sandbox-simulated before credentials exist),
 * never auto-sent: the AI drafts, the agent reviews/edits, the agent sends.
 */
export interface SendRequest {
  /** The source-side id of the ticket/message being replied to. */
  externalId?: string;
  /** The reply text shown to the requester. */
  body: string;
  /** Optional internal note (e.g. a ServiceNow work note). */
  internalNote?: string;
  /** The original raw payload, for adapters that need the vendor sys_id etc. */
  raw?: unknown;
}

export interface SendResult {
  delivered: boolean;
  mode: "live" | "sandbox";
  /** Source-side reference for the created comment / sent message, if any. */
  externalRef?: string;
  detail?: string;
}

export interface SourceAdapter {
  readonly source: NeutralSource;
  readonly kind: NeutralSourceKind;
  /**
   * Convert a vendor payload (or pasted text) into a NeutralTicket. `ctx`
   * carries the acting agent for delegated, per-agent connectors; it is unused
   * by the zero-access ManualAdapter.
   */
  ingest(input: unknown, ctx?: AgentContext): Promise<NeutralTicket> | NeutralTicket;
  /**
   * Push a reply back to the source as the acting agent (delegated). Optional:
   * only write-capable sources implement it. Falls back to a sandbox simulation
   * until real credentials are configured.
   */
  send?(req: SendRequest, ctx?: AgentContext): Promise<SendResult>;
}

/** @deprecated Use SourceAdapter. Retained for back-compat. */
export type TicketAdapter = SourceAdapter;
