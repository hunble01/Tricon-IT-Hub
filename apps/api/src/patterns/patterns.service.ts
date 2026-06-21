import { Injectable, Logger } from "@nestjs/common";
import { LlmService } from "../llm/llm.service";
import { PiiService } from "../llm/pii.service";
import { PrismaService } from "../prisma/prisma.service";

interface TicketLite {
  id: string;
  subject: string;
  body: string;
  building: string | null;
}

export interface DetectedPattern {
  theme: string;
  suggestedRootCause: string;
  building: string | null;
  count: number;
  tickets: Array<{ id: string; subject: string; building: string | null }>;
}

const SIM_THRESHOLD = 0.74; // cosine similarity to consider two tickets "related"
const MIN_CLUSTER = 2;

/**
 * Phase 3 — pattern detection. Clusters related OPEN tickets so the team sees a
 * systemic issue instead of N separate problems ("5 uniFLOW tickets at The Selby
 * → one printer/server issue"). Embeds ticket text with the live model, groups
 * by cosine similarity, then asks the model to name the likely shared root cause.
 */
@Injectable()
export class PatternsService {
  private readonly logger = new Logger(PatternsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly pii: PiiService,
  ) {}

  async detect(): Promise<{ patterns: DetectedPattern[]; analyzed: number }> {
    const rows = await this.prisma.ticket.findMany({
      where: { status: { in: ["OPEN", "PENDING"] } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { requester: { include: { building: { select: { name: true } } } } },
    });
    const tickets: TicketLite[] = rows.map((t) => ({
      id: t.id,
      subject: t.subject,
      body: t.body,
      building: t.requester?.building?.name ?? null,
    }));
    if (tickets.length < MIN_CLUSTER) return { patterns: [], analyzed: tickets.length };

    const clusters = await this.cluster(tickets);
    const sized = clusters.filter((c) => c.length >= MIN_CLUSTER);

    const patterns: DetectedPattern[] = [];
    for (const group of sized) {
      const building = sharedBuilding(group);
      patterns.push({
        ...(await this.namePattern(group, building)),
        building,
        count: group.length,
        tickets: group.map((t) => ({ id: t.id, subject: t.subject, building: t.building })),
      });
    }
    // Biggest clusters first.
    patterns.sort((a, b) => b.count - a.count);
    return { patterns, analyzed: tickets.length };
  }

  /** Group tickets via embedding cosine similarity (union-find). */
  private async cluster(tickets: TicketLite[]): Promise<TicketLite[][]> {
    let vectors: number[][] = [];
    if (this.llm.providerName !== "stub") {
      try {
        vectors = (await this.llm.embed(tickets.map((t) => `${t.subject}\n${t.body}`))).vectors;
      } catch (err) {
        this.logger.warn(`embedding failed, falling back to keyword grouping: ${(err as Error).message}`);
      }
    }
    if (vectors.length !== tickets.length) return this.keywordCluster(tickets);

    const parent = tickets.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    const union = (a: number, b: number) => { parent[find(a)] = find(b); };

    for (let i = 0; i < tickets.length; i++) {
      for (let j = i + 1; j < tickets.length; j++) {
        if (cosine(vectors[i]!, vectors[j]!) >= SIM_THRESHOLD) union(i, j);
      }
    }
    const groups = new Map<number, TicketLite[]>();
    tickets.forEach((t, i) => {
      const root = find(i);
      (groups.get(root) ?? groups.set(root, []).get(root)!).push(t);
    });
    return [...groups.values()];
  }

  /** Deterministic fallback when embeddings aren't available (stub provider). */
  private keywordCluster(tickets: TicketLite[]): TicketLite[][] {
    const KEYS = ["wifi", "print", "uniflow", "monitor", "dock", "phone", "password", "outlook", "vpn", "slow"];
    const groups = new Map<string, TicketLite[]>();
    for (const t of tickets) {
      const text = `${t.subject} ${t.body}`.toLowerCase();
      const key = KEYS.find((k) => text.includes(k)) ?? "other";
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
    }
    return [...groups.values()];
  }

  /** Ask the model for a short theme + likely shared root cause for a cluster. */
  private async namePattern(group: TicketLite[], building: string | null): Promise<{ theme: string; suggestedRootCause: string }> {
    const fallbackTheme = group[0]?.subject ?? "Related tickets";
    if (this.llm.providerName === "stub") {
      return { theme: fallbackTheme, suggestedRootCause: `${group.length} similar tickets${building ? ` at ${building}` : ""} — check for a common cause.` };
    }
    const names = (await this.prisma.staff.findMany({ select: { fullName: true } })).map((s) => s.fullName);
    const list = group.map((t, i) => `${i + 1}. ${this.pii.pseudonymize(`${t.subject} — ${t.body}`, names).text}`).join("\n");
    const system = [
      "You are an IT operations analyst. Several open tickets look related.",
      "Name the common THEME in <=6 words and the single most likely shared ROOT CAUSE (infrastructure/system, not per-user).",
      'Respond with ONLY JSON: {"theme":"...","suggestedRootCause":"..."}',
    ].join("\n");
    try {
      const { text } = await this.llm.complete({
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${building ? `Building: ${building}\n` : ""}Tickets:\n${list}` },
        ],
        temperature: 0.2,
        maxTokens: 200,
      });
      const start = text.indexOf("{"), end = text.lastIndexOf("}");
      const parsed = JSON.parse(text.slice(start, end + 1)) as { theme?: string; suggestedRootCause?: string };
      return {
        theme: parsed.theme?.slice(0, 80) || fallbackTheme,
        suggestedRootCause: parsed.suggestedRootCause || "Likely a shared cause — investigate together.",
      };
    } catch {
      return { theme: fallbackTheme, suggestedRootCause: "Likely a shared cause — investigate together." };
    }
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function sharedBuilding(group: TicketLite[]): string | null {
  const b = group[0]?.building ?? null;
  return b && group.every((t) => t.building === b) ? b : null;
}
