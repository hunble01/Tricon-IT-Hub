import { Injectable } from "@nestjs/common";
import { TaskStatus } from "@prisma/client";
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

  /**
   * Command-center metrics for the home screen: headline numbers plus a
   * "needs attention" set the IT team can act on at a glance.
   */
  async overview() {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay); endOfDay.setDate(endOfDay.getDate() + 1);
    const openTask: { in: TaskStatus[] } = { in: ["TODO", "IN_PROGRESS", "BLOCKED"] };

    const [
      fleet,
      devicesInStock,
      devicesAssigned,
      tasksOpen,
      tasksOverdue,
      tasksDueToday,
      onboardingActive,
      ticketsOpen,
      slaAtRisk,
      unreturnedFromDeparted,
      staffActive,
      buildingsLive,
    ] = await Promise.all([
      this.prisma.device.aggregate({ _sum: { purchaseCost: true }, _count: { _all: true } }),
      this.prisma.device.count({ where: { status: "IN_STOCK" } }),
      this.prisma.device.count({ where: { status: "ASSIGNED" } }),
      this.prisma.task.count({ where: { status: openTask } }),
      this.prisma.task.count({ where: { status: openTask, dueDate: { lt: now } } }),
      this.prisma.task.count({ where: { status: openTask, dueDate: { gte: startOfDay, lt: endOfDay } } }),
      this.prisma.staff.count({ where: { employmentStatus: "ONBOARDING" } }),
      this.prisma.ticket.count({ where: { status: { in: ["OPEN", "PENDING"] } } }),
      this.prisma.ticket.count({ where: { status: { in: ["OPEN", "PENDING"] }, slaDueAt: { lt: now } } }),
      this.prisma.deviceAssignment.count({
        where: { returnedAt: null, staff: { employmentStatus: "DEPARTED" } },
      }),
      this.prisma.staff.count({ where: { employmentStatus: "ACTIVE" } }),
      this.prisma.building.count({ where: { status: "LIVE" } }),
    ]);

    return {
      fleet: {
        value: Number(fleet._sum.purchaseCost ?? 0),
        total: fleet._count._all,
        inStock: devicesInStock,
        assigned: devicesAssigned,
      },
      tasks: { open: tasksOpen, overdue: tasksOverdue, dueToday: tasksDueToday },
      people: { active: staffActive, onboarding: onboardingActive },
      tickets: { open: ticketsOpen, slaAtRisk },
      buildingsLive,
      // Actionable items the IT team should clear, highest-signal first.
      attention: [
        unreturnedFromDeparted > 0 && {
          kind: "DEVICES_UNRETURNED",
          count: unreturnedFromDeparted,
          label: "device(s) still held by departed staff",
          href: "/offboarding",
        },
        slaAtRisk > 0 && { kind: "SLA_BREACH", count: slaAtRisk, label: "ticket(s) past SLA", href: "/tickets" },
        tasksOverdue > 0 && { kind: "TASKS_OVERDUE", count: tasksOverdue, label: "overdue task(s)", href: "/tasks" },
      ].filter(Boolean),
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
