import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, TicketPriority, TicketSource, TicketStatus } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types";
import { PrismaService } from "../prisma/prisma.service";
import { StaffMatcherService } from "../staff/staff-matcher.service";
import { autoPrioritize, slaDueFor } from "../tickets/ticket-policy";
import { OutlookAdapter } from "./outlook.adapter";
import { ServiceNowAdapter } from "./servicenow.adapter";

export type ConnStatus = "active" | "not_configured" | "deferred";
export type ConnMode = "live" | "sandbox" | "off";

export interface ConnectionDescriptor {
  id: string;
  name: string;
  kind: "TICKET" | "EMAIL" | "CHAT";
  role: "primary" | "secondary" | "fallback" | "deferred";
  status: ConnStatus;
  mode: ConnMode;
  canSync: boolean;
  canSend: boolean;
  phase: string;
  summary: string;
  capabilities: { read: boolean; send: boolean };
  scopes: string[];
  identity: string;
  /** Per-agent connect hint shown on the connect-flow (inert until creds). */
  connectHint?: string;
}

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly servicenow: ServiceNowAdapter,
    private readonly outlook: OutlookAdapter,
    private readonly matcher: StaffMatcherService,
  ) {}

  private sandboxOn(): boolean {
    return this.config.get<string>("SOURCES_SANDBOX") !== "false";
  }

  private modeFor(configured: boolean): ConnMode {
    if (configured) return "live";
    return this.sandboxOn() ? "sandbox" : "off";
  }

  list(): ConnectionDescriptor[] {
    const sn = this.servicenow.isConfigured();
    const ol = this.outlook.isConfigured();

    return [
      {
        id: "manual",
        name: "Manual / paste-in",
        kind: "TICKET",
        role: "fallback",
        status: "active",
        mode: "live",
        canSync: false,
        canSend: false,
        phase: "Phase 1",
        summary: "Zero-access default. Paste any ticket or email and the hub drafts a reply from memory + KB.",
        capabilities: { read: true, send: false },
        scopes: [],
        identity: "No external access",
      },
      {
        id: "servicenow",
        name: "ServiceNow",
        kind: "TICKET",
        role: "primary",
        status: sn ? "active" : "not_configured",
        mode: this.modeFor(sn),
        canSync: sn || this.sandboxOn(),
        canSend: sn || this.sandboxOn(),
        phase: "Phase 2",
        summary: "Primary ticket source via the REST Table API. View the whole queue; draft anywhere; reply only on tickets assigned to you.",
        capabilities: { read: true, send: sn || this.sandboxOn() },
        scopes: ["table_api.read (view all)", "write on assigned"],
        identity: "Delegated · per-agent (view all, act on assigned)",
        connectHint: sn
          ? "Connected via SERVICENOW_INSTANCE_URL."
          : "Set SERVICENOW_INSTANCE_URL / _USER / _PASSWORD to a PDI to go live. Sandbox active until then.",
      },
      {
        id: "outlook",
        name: "Outlook email",
        kind: "EMAIL",
        role: "secondary",
        status: ol ? "active" : "not_configured",
        mode: this.modeFor(ol),
        canSync: ol || this.sandboxOn(),
        canSend: ol || this.sandboxOn(),
        phase: "Phase 2",
        summary: "Reads support email from your own inbox via Microsoft Graph. Drafts replies; you send. Never a colleague's mailbox.",
        capabilities: { read: true, send: ol || this.sandboxOn() },
        scopes: ["Graph Mail.Read (own inbox)", "Mail.Send (own inbox)"],
        identity: "Delegated · per-agent (own mailbox only)",
        connectHint: ol
          ? "App registered (GRAPH_CLIENT_ID). Each agent signs in to connect their own inbox."
          : "Register an app in an M365 dev tenant and set GRAPH_CLIENT_ID to enable per-agent sign-in. Sandbox active until then.",
      },
      {
        id: "teams",
        name: "Microsoft Teams",
        kind: "CHAT",
        role: "deferred",
        status: "deferred",
        mode: "off",
        canSync: false,
        canSend: false,
        phase: "Deferred",
        summary: "Chat intake is deferred — protected Graph APIs need admin + Microsoft approval, for low signal value.",
        capabilities: { read: false, send: false },
        scopes: [],
        identity: "—",
      },
    ];
  }

  /** Pull recent items from a source adapter and ingest them into the ticket store. */
  async sync(id: string, actor: AuthenticatedUser) {
    const adapter = id === "servicenow" ? this.servicenow : id === "outlook" ? this.outlook : null;
    if (!adapter) throw new BadRequestException("This source can't be synced");

    const { tickets, mode } = await adapter.fetch({ userId: actor.userId });

    let created = 0;
    let updated = 0;
    let enriched = 0;
    for (const t of tickets) {
      if (!t.externalId) continue;
      const existing = await this.prisma.ticket.findUnique({
        where: { source_externalId: { source: t.source as TicketSource, externalId: t.externalId } },
      });

      // Auto-prioritize: trust the vendor's priority when it gave one, else infer.
      const priority = (t.priority as TicketPriority | undefined) ?? autoPrioritize(t.subject, t.body);
      const createdAt = t.createdAt ?? new Date();
      const slaDueAt = slaDueFor(priority, createdAt);

      // Requester auto-enrichment: link to an existing Staff record (no dup create).
      let requesterStaffId: string | undefined;
      if (t.requester?.fullName) {
        const verdict = await this.matcher.match(t.requester.fullName);
        if (verdict.kind === "match") requesterStaffId = verdict.staff.id;
      }

      const data = {
        subject: t.subject,
        body: t.body,
        status: (t.status ?? "OPEN") as TicketStatus,
        priority,
        slaDueAt,
        category: t.category ?? null,
        raw: (t.raw ?? null) as Prisma.InputJsonValue,
        ...(requesterStaffId ? { requesterStaffId } : {}),
      };
      if (requesterStaffId) enriched++;

      if (existing) {
        await this.prisma.ticket.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await this.prisma.ticket.create({
          data: {
            source: t.source as TicketSource,
            externalId: t.externalId,
            ...data,
            createdAt: t.createdAt ?? undefined,
          },
        });
        created++;
      }
    }

    await this.audit.record({
      action: "source.sync",
      userId: actor.userId,
      entityType: "Connection",
      entityId: id,
      metadata: { mode, synced: tickets.length, created, updated, enriched },
    });

    return { source: id, mode, synced: tickets.length, created, updated, enriched };
  }

  /**
   * Per-agent connect flow (Updates §5). The real flow is delegated OAuth — a
   * device-code / auth-code sign-in that yields a Graph token for the agent's
   * own inbox, and a ServiceNow session. Until the dev tenant + PDI exist this
   * returns the next concrete step rather than starting a live handshake.
   */
  async connect(id: string, actor: AuthenticatedUser) {
    const descriptor = this.list().find((c) => c.id === id);
    if (!descriptor) throw new BadRequestException("Unknown connection");
    if (descriptor.role === "deferred") throw new BadRequestException("This source is deferred");

    await this.audit.record({
      action: "source.connect.attempt",
      userId: actor.userId,
      entityType: "Connection",
      entityId: id,
      metadata: { mode: descriptor.mode },
    });

    const ready = descriptor.mode === "live";
    return {
      source: id,
      ready,
      mode: descriptor.mode,
      message: ready
        ? `${descriptor.name} is configured. Per-agent sign-in would start the delegated OAuth handshake.`
        : `${descriptor.name} runs in sandbox until credentials are set. ${descriptor.connectHint ?? ""}`.trim(),
      nextStep: descriptor.connectHint ?? "",
    };
  }
}
