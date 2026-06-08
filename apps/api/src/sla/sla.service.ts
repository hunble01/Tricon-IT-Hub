import { Injectable, Logger } from "@nestjs/common";
import { TicketStatus } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { slaState } from "../tickets/ticket-policy";

export interface SlaTicketView {
  id: string;
  subject: string;
  source: string;
  priority: string;
  status: string;
  slaDueAt: Date | null;
  hoursLeft: number | null;
  assignedTo: string | null;
  requester: string | null;
}

export interface SlaScan {
  generatedAt: Date;
  breached: SlaTicketView[];
  atRisk: SlaTicketView[];
  counts: { breached: number; atRisk: number };
}

/**
 * Phase 2 — SLA tracking. Keyless and deterministic: every open ticket has a
 * priority-derived due time (see ticket-policy), and this service surfaces the
 * ones that have breached or are about to. Used by the queue, alerts, the daily
 * briefing, and the BullMQ sweep job.
 */
@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async scan(): Promise<SlaScan> {
    const open = await this.prisma.ticket.findMany({
      where: { status: { not: TicketStatus.RESOLVED }, slaDueAt: { not: null } },
      include: {
        assignedTo: { select: { name: true } },
        requester: { select: { fullName: true } },
      },
    });

    const now = new Date();
    const breached: SlaTicketView[] = [];
    const atRisk: SlaTicketView[] = [];

    for (const t of open) {
      const s = slaState(t, now);
      const view: SlaTicketView = {
        id: t.id,
        subject: t.subject,
        source: t.source,
        priority: t.priority,
        status: t.status,
        slaDueAt: t.slaDueAt,
        hoursLeft: s.hoursLeft === null ? null : Math.round(s.hoursLeft * 10) / 10,
        assignedTo: t.assignedTo?.name ?? null,
        requester: t.requester?.fullName ?? null,
      };
      if (s.state === "breached") breached.push(view);
      else if (s.state === "at_risk") atRisk.push(view);
    }

    // Most overdue first.
    breached.sort((a, b) => (a.hoursLeft ?? 0) - (b.hoursLeft ?? 0));
    atRisk.sort((a, b) => (a.hoursLeft ?? 0) - (b.hoursLeft ?? 0));

    return { generatedAt: now, breached, atRisk, counts: { breached: breached.length, atRisk: atRisk.length } };
  }

  /**
   * The recurring job body (invoked by the BullMQ worker). Records a sweep in
   * the audit log so SLA breaches leave a durable trail; a later phase can hang
   * a digest email off the same result.
   */
  async sweep(): Promise<SlaScan> {
    const scan = await this.scan();
    if (scan.counts.breached > 0 || scan.counts.atRisk > 0) {
      this.logger.warn(
        `SLA sweep: ${scan.counts.breached} breached, ${scan.counts.atRisk} at risk`,
      );
    }
    await this.audit.record({
      action: "sla.sweep",
      entityType: "Ticket",
      metadata: scan.counts,
    });
    return scan;
  }
}
