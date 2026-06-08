import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MemoryType, Prisma, TicketPriority, TicketSource, TicketStatus } from "@prisma/client";
import type { SendRequest, SendResult, SourceAdapter, CompleteMessage } from "@tricon/shared";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types";
import { OutlookAdapter } from "../connections/outlook.adapter";
import { ServiceNowAdapter } from "../connections/servicenow.adapter";
import { LlmService } from "../llm/llm.service";
import { PiiService } from "../llm/pii.service";
import { MemoryService, RecallHit } from "../memory/memory.service";
import { PrismaService } from "../prisma/prisma.service";
import { StaffMatcherService } from "../staff/staff-matcher.service";
import { AssignTicketDto, DraftTicketDto, ResolveTicketDto, SendReplyDto } from "./dto";
import { ManualAdapter } from "./manual.adapter";
import { autoPrioritize, slaDueFor, slaState } from "./ticket-policy";

const SYSTEM_PROMPT = [
  "You are an IT support assistant for Tricon, a Toronto multi-family residential company.",
  "You help the IT team reply to staff (property managers, leasing, maintenance, concierge).",
  "Write a clear, friendly, professional reply to the requester, then a short internal note for the IT agent.",
  "Use any provided CONTEXT (past resolutions / KB) when relevant; do not invent facts.",
  "Names may appear as tokens like [[PERSON_1]] — keep them verbatim.",
  "Return your answer in EXACTLY this format:",
  "===REPLY===",
  "<reply to the requester>",
  "===NOTE===",
  "<short internal note for the IT agent>",
].join("\n");

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: ManualAdapter,
    private readonly memory: MemoryService,
    private readonly llm: LlmService,
    private readonly pii: PiiService,
    private readonly matcher: StaffMatcherService,
    private readonly audit: AuditService,
    private readonly servicenow: ServiceNowAdapter,
    private readonly outlook: OutlookAdapter,
  ) {}

  /** Resolve the write-capable adapter for a ticket source (null for manual). */
  private adapterForSource(source: TicketSource): SourceAdapter | null {
    if (source === TicketSource.SERVICENOW) return this.servicenow;
    if (source === TicketSource.OUTLOOK) return this.outlook;
    return null;
  }

  async list() {
    return this.prisma.ticket.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        requester: { select: { id: true, fullName: true } },
        assignedTo: { select: { id: true, name: true } },
        drafts: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
  }

  /**
   * The work queue (Phase 2). Live sources turn tickets into a stream, so the
   * agent needs a filterable, SLA-sorted list — not the one-at-a-time drafter.
   * Per §5: view all, act on assigned. `mine` filters to the acting agent.
   */
  async queue(
    actor: AuthenticatedUser,
    filters: { mine?: boolean; status?: TicketStatus; priority?: TicketPriority; source?: TicketSource } = {},
  ) {
    const where: Prisma.TicketWhereInput = {};
    if (filters.mine) where.assignedToUserId = actor.userId;
    if (filters.status) where.status = filters.status;
    if (filters.priority) where.priority = filters.priority;
    if (filters.source) where.source = filters.source;

    const rows = await this.prisma.ticket.findMany({
      where,
      include: {
        requester: { select: { id: true, fullName: true } },
        assignedTo: { select: { id: true, name: true } },
        drafts: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { replies: true } },
      },
      // Open before resolved; then soonest SLA due; then newest.
      orderBy: [{ status: "asc" }, { slaDueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 200,
    });

    const now = new Date();
    const PRIORITY_RANK: Record<TicketPriority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    const items = rows
      .map((t) => ({ ...t, sla: slaState(t, now), mine: t.assignedToUserId === actor.userId }))
      // Surface breached/at-risk first, then by priority, keeping the SLA order within.
      .sort((a, b) => {
        const aOpen = a.status !== TicketStatus.RESOLVED ? 0 : 1;
        const bOpen = b.status !== TicketStatus.RESOLVED ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        const risk = (s: string) => (s === "breached" ? 0 : s === "at_risk" ? 1 : 2);
        if (risk(a.sla.state) !== risk(b.sla.state)) return risk(a.sla.state) - risk(b.sla.state);
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      });

    const counts = {
      total: items.length,
      open: items.filter((t) => t.status !== TicketStatus.RESOLVED).length,
      mine: items.filter((t) => t.assignedToUserId === actor.userId).length,
      unassigned: items.filter((t) => !t.assignedToUserId && t.status !== TicketStatus.RESOLVED).length,
      breached: items.filter((t) => t.sla.state === "breached").length,
      atRisk: items.filter((t) => t.sla.state === "at_risk").length,
    };
    return { counts, items };
  }

  async get(id: string, actorUserId?: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        requester: { select: { id: true, fullName: true, email: true, building: { select: { name: true } } } },
        assignedTo: { select: { id: true, name: true } },
        drafts: { orderBy: { createdAt: "desc" } },
        replies: { orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, name: true } } } },
      },
    });
    if (!ticket) throw new NotFoundException("Ticket not found");
    return {
      ...ticket,
      sla: slaState(ticket),
      mine: actorUserId ? ticket.assignedToUserId === actorUserId : false,
    };
  }

  /** Ingest a pasted ticket, draft a reply with recalled context, persist both. */
  async draft(dto: DraftTicketDto, actor: AuthenticatedUser) {
    if (!dto.rawText?.trim() && !dto.body?.trim()) {
      throw new BadRequestException("Provide rawText or body");
    }

    const neutral = this.adapter.ingest(dto);

    // Best-effort link to an existing staff member (no silent duplicate create).
    let requesterStaffId: string | null = null;
    if (neutral.requester?.fullName) {
      const verdict = await this.matcher.match(neutral.requester.fullName);
      if (verdict.kind === "match") requesterStaffId = verdict.staff.id;
    }

    const priority = autoPrioritize(neutral.subject, neutral.body);
    const now = new Date();
    const ticket = await this.prisma.ticket.create({
      data: {
        source: "MANUAL",
        subject: neutral.subject,
        body: neutral.body,
        category: neutral.category ?? null,
        priority,
        slaDueAt: slaDueFor(priority, now),
        requesterStaffId,
        raw: (neutral.raw ?? null) as Prisma.InputJsonValue,
      },
    });

    const drafts = await this.generateDrafts(neutral.subject, neutral.body);
    const draftRows = await Promise.all(
      drafts.map((d) =>
        this.prisma.ticketDraft.create({
          data: {
            ticketId: ticket.id,
            suggestedReply: d.suggestedReply,
            suggestedNote: d.suggestedNote,
            retrievedContext: d.retrievedContext as unknown as Prisma.InputJsonValue,
            model: d.model,
          },
        }),
      ),
    );

    await this.audit.record({
      action: "ticket.draft",
      userId: actor.userId,
      entityType: "Ticket",
      entityId: ticket.id,
      metadata: {
        draftIds: draftRows.map((r) => r.id),
        models: drafts.map((d) => d.model),
        contextCount: drafts[0]?.retrievedContext.length ?? 0,
      },
    });

    return this.get(ticket.id, actor.userId);
  }

  /** Re-run drafting for an existing ticket (e.g., after memory grew). */
  async redraft(id: string, actor: AuthenticatedUser) {
    const ticket = await this.get(id);
    const drafts = await this.generateDrafts(ticket.subject, ticket.body);

    await Promise.all(
      drafts.map((d) =>
        this.prisma.ticketDraft.create({
          data: {
            ticketId: ticket.id,
            suggestedReply: d.suggestedReply,
            suggestedNote: d.suggestedNote,
            retrievedContext: d.retrievedContext as unknown as Prisma.InputJsonValue,
            model: d.model,
          },
        }),
      ),
    );

    await this.audit.record({
      action: "ticket.redraft",
      userId: actor.userId,
      entityType: "Ticket",
      entityId: ticket.id,
      metadata: {
        models: drafts.map((d) => d.model),
        contextCount: drafts[0]?.retrievedContext.length ?? 0,
      },
    });

    return this.get(ticket.id, actor.userId);
  }

  /** Mark resolved and remember the resolution so future tickets can recall it. */
  async resolve(id: string, dto: ResolveTicketDto, actor: AuthenticatedUser) {
    const ticket = await this.get(id);
    await this.prisma.ticket.update({
      where: { id },
      data: { status: "RESOLVED" },
    });

    await this.memory.remember({
      type: MemoryType.TICKET_RESOLUTION,
      content: `Issue: ${ticket.subject}\n${ticket.body}\n\nResolution: ${dto.resolution}`,
      refTable: "Ticket",
      refId: ticket.id,
      metadata: { subject: ticket.subject },
    });

    await this.audit.record({
      action: "ticket.resolve",
      userId: actor.userId,
      entityType: "Ticket",
      entityId: ticket.id,
    });

    return this.get(id, actor.userId);
  }

  /**
   * Claim (or assign) a ticket. Per §5 the act-on-assigned rule unlocks reply,
   * so an agent claims a ticket to take ownership. `userId` assigns to a
   * specific agent; omitted, it claims for the acting agent.
   */
  async assign(id: string, dto: AssignTicketDto, actor: AuthenticatedUser) {
    await this.get(id);
    const targetUserId = dto.userId ?? actor.userId;
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new BadRequestException("Unknown user");

    await this.prisma.ticket.update({
      where: { id },
      data: { assignedToUserId: targetUserId, assignedAt: new Date() },
    });
    await this.audit.record({
      action: dto.userId ? "ticket.assign" : "ticket.claim",
      userId: actor.userId,
      entityType: "Ticket",
      entityId: id,
      metadata: { assignedTo: targetUserId },
    });
    return this.get(id, actor.userId);
  }

  /** Release a claim. */
  async unassign(id: string, actor: AuthenticatedUser) {
    await this.get(id);
    await this.prisma.ticket.update({
      where: { id },
      data: { assignedToUserId: null, assignedAt: null },
    });
    await this.audit.record({
      action: "ticket.unassign",
      userId: actor.userId,
      entityType: "Ticket",
      entityId: id,
    });
    return this.get(id, actor.userId);
  }

  /**
   * Send a reply back to the source as the acting agent (human-in-the-loop).
   * Enforces the §5 rule as a server check: only the agent the ticket is
   * assigned to may send. Manual tickets have no external channel — the reply
   * is logged but not pushed. External sources push via the adapter (real, or
   * sandbox-simulated until credentials exist). Never auto-sent.
   */
  async send(id: string, dto: SendReplyDto, actor: AuthenticatedUser) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException("Ticket not found");

    // Act-on-assigned: must be claimed by the acting agent first.
    if (ticket.assignedToUserId !== actor.userId) {
      throw new ForbiddenException(
        ticket.assignedToUserId
          ? "This ticket is assigned to another agent"
          : "Claim this ticket before replying",
      );
    }

    const adapter = this.adapterForSource(ticket.source);
    let result: SendResult;
    if (adapter?.send) {
      const req: SendRequest = {
        externalId: ticket.externalId ?? undefined,
        body: dto.body,
        internalNote: dto.internalNote,
        raw: ticket.raw,
      };
      result = await adapter.send(req, { userId: actor.userId });
    } else {
      // Manual / paste-in: no external target. Record the reply for the trail.
      result = { delivered: false, mode: "sandbox", detail: "No external channel (manual ticket)" };
    }

    const reply = await this.prisma.ticketReply.create({
      data: {
        ticketId: ticket.id,
        userId: actor.userId,
        channel: ticket.source,
        body: dto.body,
        internalNote: dto.internalNote ?? null,
        mode: result.mode,
        delivered: result.delivered,
        externalRef: result.externalRef ?? null,
      },
    });

    // A sent reply moves an open ticket to PENDING (waiting on the requester).
    await this.prisma.ticket.update({
      where: { id },
      data: {
        lastReplyAt: new Date(),
        status: ticket.status === TicketStatus.OPEN ? TicketStatus.PENDING : ticket.status,
      },
    });

    await this.audit.record({
      action: "ticket.send",
      userId: actor.userId,
      entityType: "Ticket",
      entityId: id,
      metadata: { replyId: reply.id, channel: ticket.source, mode: result.mode, delivered: result.delivered },
    });

    return this.get(id, actor.userId);
  }

  /** Index KB articles into memory so recall has knowledge from day one. */
  async reindexKnowledge(actor: AuthenticatedUser) {
    const articles = await this.prisma.knowledgeArticle.findMany();
    let indexed = 0;
    for (const a of articles) {
      await this.memory.remember({
        type: MemoryType.KB,
        content: `${a.title}\n\n${a.content}`,
        refTable: "KnowledgeArticle",
        refId: a.id,
        metadata: { title: a.title, tags: a.tags },
      });
      indexed++;
    }
    await this.audit.record({
      action: "ticket.kb.reindex",
      userId: actor.userId,
      entityType: "KnowledgeArticle",
      metadata: { indexed },
    });
    return { indexed };
  }

  // ---- internals -------------------------------------------------------

  /**
   * Produce a draft from every configured completion model (e.g. Claude + GPT)
   * for side-by-side comparison. Recall and PII pseudonymization run ONCE and
   * are shared across models — only the completion differs, so the retrieved
   * context is identical and the cost difference is just the extra completion.
   * Returns one entry per model that answered (primary first).
   */
  private async generateDrafts(subject: string, body: string) {
    const query = `${subject}\n${body}`.trim();
    const hits = await this.memory.recall(query, {
      types: [MemoryType.TICKET_RESOLUTION, MemoryType.KB, MemoryType.STAFF_CONTEXT],
      limit: 5,
      minScore: 0.1,
    });

    const names = await this.knownNames();
    const contextBlock = this.renderContext(hits);

    const rawUserContent =
      `TICKET\nSubject: ${subject}\n\n${body}\n\n` +
      (contextBlock ? `CONTEXT (most relevant first):\n${contextBlock}\n` : "");

    // Pseudonymize everything that leaves for completion; rehydrate on return.
    const { text: safeContent, map } = this.pii.pseudonymize(rawUserContent, names);

    const messages: CompleteMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: safeContent },
    ];

    const retrievedContext = hits.map((h) => ({
      type: h.type,
      refTable: h.refTable,
      refId: h.refId,
      score: Number(h.score.toFixed(3)),
      snippet: h.content.length > 240 ? `${h.content.slice(0, 240)}…` : h.content,
    }));

    const completions = await this.llm.completeAll({ messages, temperature: 0.3, maxTokens: 700 });
    return completions.map((completion) => {
      const parsed = parseDraft(completion.text);
      return {
        suggestedReply: this.pii.rehydrate(parsed.reply, map),
        suggestedNote: parsed.note ? this.pii.rehydrate(parsed.note, map) : null,
        model: completion.model,
        retrievedContext,
      };
    });
  }

  private async knownNames(): Promise<string[]> {
    const staff = await this.prisma.staff.findMany({
      select: { fullName: true, lastName: true },
    });
    const names: string[] = [];
    for (const s of staff) {
      if (s.fullName) names.push(s.fullName);
      if (s.lastName) names.push(s.lastName);
    }
    return names;
  }

  private renderContext(hits: RecallHit[]): string {
    return hits
      .map((h, i) => {
        const snippet = h.content.length > 400 ? `${h.content.slice(0, 400)}…` : h.content;
        return `[${i + 1}] (${h.type}) ${snippet}`;
      })
      .join("\n\n");
  }
}

function parseDraft(text: string): { reply: string; note: string | null } {
  const afterReply = text.split(/===\s*REPLY\s*===/i)[1];
  if (afterReply !== undefined) {
    const [reply, note] = afterReply.split(/===\s*NOTE\s*===/i);
    return { reply: (reply ?? "").trim(), note: note?.trim() || null };
  }
  return { reply: text.trim(), note: null };
}
