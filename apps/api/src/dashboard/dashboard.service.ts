import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

function tally<T extends string>(
  rows: Array<{ _count: number } & Record<string, unknown>>,
  key: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[String(r[key] as T)] = r._count;
  }
  return out;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Aggregate counts across the platform for the dashboard tiles. */
  async summary() {
    const [
      staffTotal,
      staffByStatus,
      deviceTotal,
      deviceByStatus,
      onboardingTotal,
      onboardingByDevice,
      ticketTotal,
      ticketByStatus,
      buildings,
      roles,
      kb,
      memory,
    ] = await Promise.all([
      this.prisma.staff.count(),
      this.prisma.staff.groupBy({ by: ["employmentStatus"], _count: true }),
      this.prisma.device.count(),
      this.prisma.device.groupBy({ by: ["status"], _count: true }),
      this.prisma.onboarding.count(),
      this.prisma.onboarding.groupBy({ by: ["deviceStatus"], _count: true }),
      this.prisma.ticket.count(),
      this.prisma.ticket.groupBy({ by: ["status"], _count: true }),
      this.prisma.building.count(),
      this.prisma.role.count(),
      this.prisma.knowledgeArticle.count(),
      this.prisma.memoryEntry.count(),
    ]);

    return {
      staff: { total: staffTotal, byStatus: tally(staffByStatus, "employmentStatus") },
      devices: { total: deviceTotal, byStatus: tally(deviceByStatus, "status") },
      onboardings: {
        total: onboardingTotal,
        byDeviceStatus: tally(onboardingByDevice, "deviceStatus"),
      },
      tickets: { total: ticketTotal, byStatus: tally(ticketByStatus, "status") },
      catalog: { buildings, roles, knowledgeArticles: kb, memoryEntries: memory },
    };
  }

  /** Most recent audit-log entries, with the acting user. */
  async recentActivity(limit = 20) {
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { user: { select: { name: true, email: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actor: r.user?.name ?? r.user?.email ?? "system",
      metadata: r.metadata,
      createdAt: r.createdAt,
    }));
  }
}
