import { Injectable, Logger } from "@nestjs/common";
import { MemoryType, Prisma } from "@prisma/client";
import { LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";

export interface RememberInput {
  type: MemoryType;
  content: string;
  refTable?: string | null;
  refId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface RecallOptions {
  types?: MemoryType[];
  limit?: number;
  /** Drop results below this similarity (0..1). */
  minScore?: number;
}

export interface RecallHit {
  id: string;
  type: MemoryType;
  refTable: string | null;
  refId: string | null;
  content: string;
  metadata: unknown;
  score: number;
}

/**
 * Unified AI-memory store. Embeddings + vectors live in our Postgres and never
 * leave the VPS. recall() drives ticket suggestions; remember() persists
 * resolutions/KB/staff context. Vector ops use $queryRaw because the embedding
 * column is an Unsupported pgvector type. Falls back to pg_trgm similarity when
 * no embeddings are present yet.
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /** Persist a memory entry and, best-effort, its embedding. */
  async remember(input: RememberInput): Promise<string> {
    const entry = await this.prisma.memoryEntry.create({
      data: {
        type: input.type,
        content: input.content,
        refTable: input.refTable ?? null,
        refId: input.refId ?? null,
        metadata:
          input.metadata == null
            ? undefined
            : (input.metadata as unknown as Prisma.InputJsonValue),
      },
    });

    try {
      const vec = await this.llm.embedOne(input.content);
      if (vec.length > 0) {
        const literal = `[${vec.join(",")}]`;
        await this.prisma.$executeRaw`
          UPDATE "MemoryEntry" SET embedding = ${literal}::vector WHERE id = ${entry.id}
        `;
      }
    } catch (err) {
      // Keep the row (content is still searchable via trgm); just log the miss.
      this.logger.error(`embedding failed for memory ${entry.id}`, err as Error);
    }

    return entry.id;
  }

  /**
   * Re-embed every memory entry with the currently-configured provider, in
   * place. Run this once after switching embedding providers (e.g. hash-embed →
   * OpenAI): otherwise old vectors live in the same column as new ones but in a
   * different space, poisoning vector recall. Idempotent — safe to re-run.
   */
  async reembedAll(batchSize = 64): Promise<{ total: number; embedded: number; failed: number }> {
    const entries = await this.prisma.memoryEntry.findMany({
      select: { id: true, content: true },
      orderBy: { createdAt: "asc" },
    });
    let embedded = 0;
    let failed = 0;

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (e) => {
          try {
            const vec = await this.llm.embedOne(e.content);
            if (vec.length === 0) {
              failed++;
              return;
            }
            const literal = `[${vec.join(",")}]`;
            await this.prisma.$executeRaw`
              UPDATE "MemoryEntry" SET embedding = ${literal}::vector WHERE id = ${e.id}
            `;
            embedded++;
          } catch (err) {
            failed++;
            this.logger.error(`re-embed failed for memory ${e.id}`, err as Error);
          }
        }),
      );
      this.logger.log(`re-embed progress: ${Math.min(i + batchSize, entries.length)}/${entries.length}`);
    }

    this.logger.log(`re-embed complete: ${embedded} embedded, ${failed} failed of ${entries.length}`);
    return { total: entries.length, embedded, failed };
  }

  /** Retrieve the most relevant memory entries for a query. */
  async recall(query: string, opts: RecallOptions = {}): Promise<RecallHit[]> {
    const limit = opts.limit ?? 5;
    const minScore = opts.minScore ?? 0;
    if (!query.trim()) return [];

    const embeddedCount = await this.countEmbedded();
    if (embeddedCount > 0) {
      try {
        return await this.vectorRecall(query, opts.types, limit, minScore);
      } catch (err) {
        this.logger.error("vector recall failed, falling back to trgm", err as Error);
      }
    }
    return this.trgmRecall(query, opts.types, limit, minScore);
  }

  private async countEmbedded(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM "MemoryEntry" WHERE embedding IS NOT NULL
    `;
    return Number(rows[0]?.count ?? 0);
  }

  private async vectorRecall(
    query: string,
    types: MemoryType[] | undefined,
    limit: number,
    minScore: number,
  ): Promise<RecallHit[]> {
    const vec = await this.llm.embedOne(query);
    const literal = `[${vec.join(",")}]`;
    const typeClause =
      types && types.length
        ? Prisma.sql`AND type::text IN (${Prisma.join(types)})`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<RecallHit[]>`
      SELECT id, type, "refTable", "refId", content, metadata,
             1 - (embedding <=> ${literal}::vector) AS score
      FROM "MemoryEntry"
      WHERE embedding IS NOT NULL
      ${typeClause}
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${limit}
    `;
    return rows.filter((r) => r.score >= minScore);
  }

  private async trgmRecall(
    query: string,
    types: MemoryType[] | undefined,
    limit: number,
    minScore: number,
  ): Promise<RecallHit[]> {
    const typeClause =
      types && types.length
        ? Prisma.sql`AND type::text IN (${Prisma.join(types)})`
        : Prisma.empty;
    const floor = Math.max(minScore, 0.05);

    return this.prisma.$queryRaw<RecallHit[]>`
      SELECT id, type, "refTable", "refId", content, metadata,
             similarity(content, ${query}) AS score
      FROM "MemoryEntry"
      WHERE similarity(content, ${query}) >= ${floor}
      ${typeClause}
      ORDER BY score DESC
      LIMIT ${limit}
    `;
  }
}
