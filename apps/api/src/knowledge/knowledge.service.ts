import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { MemoryType } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types";
import { LlmService } from "../llm/llm.service";
import { PiiService } from "../llm/pii.service";
import { MemoryService } from "../memory/memory.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateArticleDto, GenerateArticleDto } from "./dto";

export interface ArticleDraft {
  title: string;
  content: string;
  tags: string[];
  sourceTicketId: string;
}

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly memory: MemoryService,
    private readonly audit: AuditService,
    private readonly pii: PiiService,
  ) {}

  async list(q?: string) {
    return this.prisma.knowledgeArticle.findMany({
      where: q
        ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { content: { contains: q, mode: "insensitive" } }] }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  /**
   * Draft a reusable KB article from a resolved ticket (Phase 3 — KB-from-
   * resolution). Pulls the ticket's stored resolution memory, pseudonymizes any
   * staff names before the text leaves for the model, and returns a draft for
   * the agent to review — never auto-saved.
   */
  async generateFromTicket(dto: GenerateArticleDto): Promise<ArticleDraft> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: dto.ticketId } });
    if (!ticket) throw new NotFoundException("Ticket not found");

    const resolutionMem = await this.prisma.memoryEntry.findFirst({
      where: { type: MemoryType.TICKET_RESOLUTION, refTable: "Ticket", refId: ticket.id },
      orderBy: { createdAt: "desc" },
    });
    const sourceText = resolutionMem?.content ?? `Issue: ${ticket.subject}\n${ticket.body}`;

    if (this.llm.providerName === "stub") {
      // No model — return a structured stub the agent can flesh out.
      return {
        title: ticket.subject,
        content: `## Symptom\n${ticket.body}\n\n## Resolution\n_Add the steps here (configure an LLM key to auto-draft)._`,
        tags: ["draft"],
        sourceTicketId: ticket.id,
      };
    }

    // Governance: mask staff names before the text leaves the VPS.
    const names = (await this.prisma.staff.findMany({ select: { fullName: true } })).map((s) => s.fullName);
    const masked = this.pii.pseudonymize(sourceText, names);

    const system = [
      "You write concise, reusable IT knowledge-base articles for a support team.",
      "Turn the resolved issue into a general how-to that will help with FUTURE similar issues.",
      "Do NOT include any person's name, ticket id, or one-off specifics. Write in markdown.",
      'Respond with ONLY JSON: {"title": "...", "content": "## Symptom\\n...\\n\\n## Cause\\n...\\n\\n## Resolution\\n1. ...", "tags": ["..."]}',
    ].join("\n");

    const { text } = await this.llm.complete({
      messages: [
        { role: "system", content: system },
        { role: "user", content: masked.text },
      ],
      temperature: 0.2,
      maxTokens: 700,
    });

    const parsed = extractJson(text);
    return {
      title: this.pii.rehydrate(String(parsed.title ?? ticket.subject), masked.map).slice(0, 200),
      content: this.pii.rehydrate(String(parsed.content ?? ""), masked.map),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 8) : [],
      sourceTicketId: ticket.id,
    };
  }

  /** Save an article and index it into AI memory so recall can surface it. */
  async create(dto: CreateArticleDto, actor: AuthenticatedUser) {
    const article = await this.prisma.knowledgeArticle.create({
      data: {
        title: dto.title,
        content: dto.content,
        tags: dto.tags ?? [],
        source: dto.source ?? (dto.sourceTicketId ? "Generated from ticket" : "Manual"),
      },
    });

    // Index into pgvector memory so Ask the Hub / ticket recall can find it.
    await this.memory.remember({
      type: MemoryType.KB,
      content: `${article.title}\n\n${article.content}`,
      refTable: "KnowledgeArticle",
      refId: article.id,
      metadata: { title: article.title, sourceTicketId: dto.sourceTicketId ?? null },
    });

    await this.audit.record({
      action: "knowledge.create",
      userId: actor.userId,
      entityType: "KnowledgeArticle",
      entityId: article.id,
      metadata: { title: article.title, fromTicket: dto.sourceTicketId ?? null },
    });

    return article;
  }
}

function extractJson(text: string): { title?: unknown; content?: unknown; tags?: unknown } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new BadRequestException("Model returned no article");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new BadRequestException("Model returned an unparseable article");
  }
}
