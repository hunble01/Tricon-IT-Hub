import { Injectable } from "@nestjs/common";
import { Prisma, Staff } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { normalize } from "./name";

export interface StaffMatch {
  staff: Staff;
  similarity: number;
}

export type MatchVerdict =
  | { kind: "match"; staff: Staff; similarity: number }
  | { kind: "suggest"; candidates: StaffMatch[] }
  | { kind: "create" };

const HIGH_CONFIDENCE = 0.7;
const SUGGEST_FLOOR = 0.35;

/**
 * Fuzzy lookup over Staff using pg_trgm `similarity()`.
 *
 *   similarity ≥ HIGH_CONFIDENCE → kind: "match"
 *   similarity ≥ SUGGEST_FLOOR   → kind: "suggest" (top N candidates)
 *   otherwise                    → kind: "create"
 *
 * Used to keep a paste-in ticket from silently creating a duplicate staff
 * when an existing record differs only by punctuation, nickname, or typo.
 */
@Injectable()
export class StaffMatcherService {
  constructor(private readonly prisma: PrismaService) {}

  async match(rawName: string, opts: { buildingId?: string | null } = {}): Promise<MatchVerdict> {
    const query = normalize(rawName);
    if (!query) return { kind: "create" };

    const buildingFilter = opts.buildingId
      ? Prisma.sql`AND "buildingId" = ${opts.buildingId}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<Array<Staff & { similarity: number }>>(Prisma.sql`
      SELECT *,
             similarity("fullName", ${query})::float8 AS similarity
      FROM "Staff"
      WHERE similarity("fullName", ${query}) >= ${SUGGEST_FLOOR}
      ${buildingFilter}
      ORDER BY similarity DESC
      LIMIT 5
    `);

    if (rows.length === 0) return { kind: "create" };

    const best = rows[0]!;
    if (best.similarity >= HIGH_CONFIDENCE) {
      const { similarity, ...staff } = best;
      return { kind: "match", staff: staff as Staff, similarity };
    }
    return {
      kind: "suggest",
      candidates: rows.map((r) => {
        const { similarity, ...staff } = r;
        return { staff: staff as Staff, similarity };
      }),
    };
  }
}
