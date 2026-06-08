import { Injectable } from "@nestjs/common";
import {
  EmploymentStatus,
  OffboardingStatus,
  OnboardingDeviceStatus,
  TicketStatus,
} from "@prisma/client";
import { AlertsService } from "../alerts/alerts.service";
import { PrismaService } from "../prisma/prisma.service";
import { SlaService } from "../sla/sla.service";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Phase 2 — the daily briefing. One read-model that answers "what should the IT
 * team look at today": tickets against SLA, hires arriving, leavers to close
 * out, gear to recover, and what to order. Keyless; composes the alerts + SLA
 * services with a few direct counts.
 */
@Injectable()
export class BriefingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly sla: SlaService,
  ) {}

  async build() {
    const now = new Date();
    const weekAhead = new Date(now.getTime() + WEEK_MS);

    const [
      slaScan,
      alertReport,
      openTickets,
      unassignedTickets,
      onboardings,
      offboardings,
      departedHolding,
    ] = await Promise.all([
      this.sla.scan(),
      this.alerts.compute(),
      this.prisma.ticket.count({ where: { status: { not: TicketStatus.RESOLVED } } }),
      this.prisma.ticket.count({
        where: { status: { not: TicketStatus.RESOLVED }, assignedToUserId: null },
      }),
      this.prisma.onboarding.findMany({ include: { staff: { select: { fullName: true } } } }),
      this.prisma.offboarding.findMany({
        where: { status: { not: OffboardingStatus.COMPLETED } },
        include: {
          staff: {
            select: {
              fullName: true,
              devices: { where: { returnedAt: null }, select: { id: true } },
            },
          },
        },
      }),
      this.prisma.deviceAssignment.count({
        where: {
          returnedAt: null,
          staff: { employmentStatus: { in: [EmploymentStatus.DEPARTED, EmploymentStatus.NO_SHOW] } },
        },
      }),
    ]);

    // Onboarding: arriving this week vs. overdue with devices still pending.
    const arriving = onboardings.filter(
      (o) => o.startDate && o.startDate >= now && o.startDate <= weekAhead,
    );
    const overdue = onboardings.filter(
      (o) => o.startDate && o.startDate < now && o.deviceStatus === OnboardingDeviceStatus.PENDING,
    );

    // Offboarding: leaving this week + total gear still out across all leavers.
    const leavingThisWeek = offboardings.filter(
      (o) => o.lastDay && o.lastDay >= now && o.lastDay <= weekAhead,
    );
    const gearToReclaim = offboardings.reduce((n, o) => n + o.staff.devices.length, 0);

    // What to order (from the stock-shortfall alert).
    const shortfall = alertReport.alerts.find((a) => a.id === "stock_shortfall");
    const toOrder = (shortfall?.items ?? []).map((i) => ({ label: i.label, meta: i.meta }));

    const sections = {
      tickets: {
        open: openTickets,
        unassigned: unassignedTickets,
        breached: slaScan.counts.breached,
        atRisk: slaScan.counts.atRisk,
        topAtRisk: [...slaScan.breached, ...slaScan.atRisk].slice(0, 6),
      },
      onboarding: {
        arrivingThisWeek: arriving.length,
        overdue: overdue.length,
        items: [...overdue, ...arriving].slice(0, 8).map((o) => ({
          name: o.staff.fullName,
          startDate: o.startDate,
          deviceStatus: o.deviceStatus,
          overdue: !!(o.startDate && o.startDate < now && o.deviceStatus === OnboardingDeviceStatus.PENDING),
        })),
      },
      offboarding: {
        inProgress: offboardings.length,
        leavingThisWeek: leavingThisWeek.length,
        gearToReclaim,
        items: offboardings.slice(0, 8).map((o) => ({
          name: o.staff.fullName,
          lastDay: o.lastDay,
          status: o.status,
          gearOut: o.staff.devices.length,
        })),
      },
      inventory: {
        departedHolding,
        toOrder,
      },
      alerts: {
        summary: alertReport.summary,
        digest: alertReport.digest,
      },
    };

    return { generatedAt: now, headline: this.headline(sections), sections };
  }

  private headline(s: {
    tickets: { breached: number; atRisk: number; unassigned: number };
    offboarding: { gearToReclaim: number };
    onboarding: { overdue: number; arrivingThisWeek: number };
  }): string {
    const parts: string[] = [];
    if (s.tickets.breached) parts.push(`${s.tickets.breached} ticket(s) past SLA`);
    if (s.tickets.atRisk) parts.push(`${s.tickets.atRisk} nearing SLA`);
    if (s.tickets.unassigned) parts.push(`${s.tickets.unassigned} unassigned`);
    if (s.onboarding.overdue) parts.push(`${s.onboarding.overdue} onboarding(s) overdue`);
    if (s.onboarding.arrivingThisWeek) parts.push(`${s.onboarding.arrivingThisWeek} hire(s) this week`);
    if (s.offboarding.gearToReclaim) parts.push(`${s.offboarding.gearToReclaim} device(s) to reclaim`);
    return parts.length ? parts.join(" · ") : "All clear — nothing pressing today.";
  }
}
