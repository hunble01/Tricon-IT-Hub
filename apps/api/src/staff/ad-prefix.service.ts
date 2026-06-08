import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { normalize } from "./name";

const MAX_ATTEMPTS = 12;

/**
 * AD prefix suggester. Convention:
 *   firstInitial + lastName, lowercased (Jason Harrison → "jharrison").
 * On collision, extend the first name (jharris..., jhar...) until unique.
 * As a last resort, append a numeric suffix.
 */
@Injectable()
export class AdPrefixService {
  constructor(private readonly prisma: PrismaService) {}

  async suggest(firstName: string, lastName: string): Promise<{
    suggestion: string;
    candidates: string[];
    collisions: string[];
  }> {
    const cleanFirst = normalize(firstName).replace(/\s|'|-/g, "");
    const cleanLast = normalize(lastName).replace(/\s|'|-/g, "");
    if (!cleanFirst || !cleanLast) {
      return { suggestion: "", candidates: [], collisions: [] };
    }

    const candidates: string[] = [];
    for (let i = 1; i <= Math.min(MAX_ATTEMPTS, cleanFirst.length); i++) {
      candidates.push(cleanFirst.slice(0, i) + cleanLast);
    }

    const existing = await this.prisma.staff.findMany({
      where: { adPrefix: { in: candidates } },
      select: { adPrefix: true },
    });
    const taken = new Set(existing.map((s) => s.adPrefix).filter((x): x is string => !!x));

    for (const c of candidates) {
      if (!taken.has(c)) return { suggestion: c, candidates, collisions: [...taken] };
    }

    // Fall back to numeric suffix on the longest variant.
    const base = candidates[candidates.length - 1]!;
    for (let n = 2; n < 50; n++) {
      const c = `${base}${n}`;
      const exists = await this.prisma.staff.findFirst({
        where: { adPrefix: c },
        select: { id: true },
      });
      if (!exists) {
        return { suggestion: c, candidates: [...candidates, c], collisions: [...taken] };
      }
    }

    return { suggestion: "", candidates, collisions: [...taken] };
  }
}
