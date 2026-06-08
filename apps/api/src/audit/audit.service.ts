import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditEntry {
  action: string;
  userId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | unknown[] | null;
}

/**
 * Append-only audit log writer. Every mutating service should call record().
 * Failures here MUST NOT take down the calling write — we log and swallow.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          userId: entry.userId ?? null,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          metadata:
            entry.metadata == null
              ? undefined
              : (entry.metadata as unknown as Prisma.InputJsonValue),
        },
      });
    } catch (err) {
      this.logger.error(`audit write failed for action=${entry.action}`, err as Error);
    }
  }
}
