import { Injectable } from "@nestjs/common";
import { DeviceStatus, DeviceType, EmploymentStatus, OnboardingDeviceStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SlaService } from "../sla/sla.service";

type Severity = "high" | "medium" | "low";

interface AlertItem {
  label: string;
  meta?: string;
  href?: string;
}
interface Alert {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  count: number;
  items: AlertItem[];
}

const VALID_TYPES = new Set<string>(Object.values(DeviceType));

function normalizeRec(raw: unknown): Array<{ type: string; quantity: number }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) =>
      typeof d === "string"
        ? { type: d, quantity: 1 }
        : { type: (d as { type?: string })?.type ?? "", quantity: (d as { quantity?: number })?.quantity ?? 1 },
    )
    .filter((d) => typeof d.type === "string" && d.type.length > 0);
}

/**
 * Proactive intelligence — scans the data for things that need attention so the
 * IT team doesn't have to notice manually. All deterministic / keyless.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sla: SlaService,
  ) {}

  async compute() {
    const now = new Date();
    const alerts: Alert[] = [];

    // 0. SLA — tickets past their response deadline (high) / about to breach (medium)
    const slaScan = await this.sla.scan();
    if (slaScan.breached.length) {
      alerts.push({
        id: "sla_breached",
        severity: "high",
        category: "Tickets",
        title: `${slaScan.breached.length} ticket${slaScan.breached.length === 1 ? "" : "s"} past SLA`,
        detail: "Open tickets are past their response deadline — reply or reprioritize.",
        count: slaScan.breached.length,
        items: slaScan.breached.slice(0, 50).map((t) => ({
          label: t.subject,
          meta: [t.priority.toLowerCase(), t.assignedTo ? `→ ${t.assignedTo}` : "unassigned"].join(" · "),
          href: `/tickets?id=${t.id}`,
        })),
      });
    }
    if (slaScan.atRisk.length) {
      alerts.push({
        id: "sla_at_risk",
        severity: "medium",
        category: "Tickets",
        title: `${slaScan.atRisk.length} ticket${slaScan.atRisk.length === 1 ? "" : "s"} nearing SLA`,
        detail: "Response deadline is approaching — these need attention soon.",
        count: slaScan.atRisk.length,
        items: slaScan.atRisk.slice(0, 50).map((t) => ({
          label: t.subject,
          meta: [t.priority.toLowerCase(), t.hoursLeft != null ? `${t.hoursLeft}h left` : ""].filter(Boolean).join(" · "),
          href: `/tickets?id=${t.id}`,
        })),
      });
    }

    // 1. Missing devices (from site audits) — high
    const missing = await this.prisma.device.findMany({
      where: { status: DeviceStatus.MISSING },
      include: { location: true },
      take: 50,
    });
    if (missing.length) {
      alerts.push({
        id: "devices_missing",
        severity: "high",
        category: "Inventory",
        title: `${missing.length} device${missing.length === 1 ? "" : "s"} missing`,
        detail: "Flagged missing in a site audit — not found where records expected.",
        count: missing.length,
        items: missing.map((d) => ({
          label: `${d.type} ${d.model ?? ""}`.trim(),
          meta: [d.assetTag ? `#${d.assetTag}` : "", d.location?.name].filter(Boolean).join(" · "),
          href: `/devices/${d.id}`,
        })),
      });
    }

    // 2. Devices still held by departed / no-show staff — high
    const departed = await this.prisma.deviceAssignment.findMany({
      where: {
        returnedAt: null,
        staff: { employmentStatus: { in: [EmploymentStatus.DEPARTED, EmploymentStatus.NO_SHOW] } },
      },
      include: { device: true, staff: true },
      take: 50,
    });
    if (departed.length) {
      alerts.push({
        id: "departed_holding",
        severity: "high",
        category: "Recovery",
        title: `${departed.length} device${departed.length === 1 ? "" : "s"} with departed staff`,
        detail: "Equipment still assigned to people marked departed or no-show — should be recovered.",
        count: departed.length,
        items: departed.map((a) => ({
          label: `${a.device.type} ${a.device.model ?? ""}`.trim(),
          meta: `held by ${a.staff.fullName}`,
          href: `/devices/${a.device.id}`,
        })),
      });
    }

    // 3. Onboardings past start date with devices still pending — medium
    const pendingOb = await this.prisma.onboarding.findMany({
      where: { deviceStatus: OnboardingDeviceStatus.PENDING },
      include: { staff: true },
    });
    const stuck = pendingOb.filter((o) => o.startDate && o.startDate < now);
    if (stuck.length) {
      alerts.push({
        id: "onboarding_stuck",
        severity: "medium",
        category: "Onboarding",
        title: `${stuck.length} onboarding${stuck.length === 1 ? "" : "s"} past start, devices pending`,
        detail: "Start date has passed but hardware isn't provisioned yet.",
        count: stuck.length,
        items: stuck.map((o) => ({
          label: o.staff.fullName,
          meta: o.startDate ? `started ${o.startDate.toLocaleDateString()}` : "",
          href: "/onboarding",
        })),
      });
    }

    // 4. Stock shortfall vs. upcoming onboarding demand — medium
    const demand: Record<string, number> = {};
    for (const o of pendingOb) {
      for (const rec of normalizeRec(o.recommendedDevices)) {
        if (VALID_TYPES.has(rec.type)) demand[rec.type] = (demand[rec.type] ?? 0) + rec.quantity;
      }
    }
    const stockRows = await this.prisma.device.groupBy({
      by: ["type"],
      where: { status: DeviceStatus.IN_STOCK },
      _count: true,
    });
    const stock: Record<string, number> = {};
    for (const r of stockRows) stock[r.type] = r._count;
    const shortfalls = Object.entries(demand)
      .map(([type, need]) => ({ type, need, have: stock[type] ?? 0, short: need - (stock[type] ?? 0) }))
      .filter((s) => s.short > 0);
    if (shortfalls.length) {
      alerts.push({
        id: "stock_shortfall",
        severity: "medium",
        category: "Procurement",
        title: `Short on ${shortfalls.length} device type${shortfalls.length === 1 ? "" : "s"} for upcoming hires`,
        detail: "Recommended devices for pending onboardings exceed what's in stock.",
        count: shortfalls.reduce((n, s) => n + s.short, 0),
        items: shortfalls.map((s) => ({
          label: s.type.toLowerCase().replace(/_/g, " "),
          meta: `need ${s.need}, have ${s.have} → order ${s.short}`,
        })),
      });
    }

    // 5. Misplaced devices — low
    const misplaced = await this.prisma.device.findMany({
      where: { status: DeviceStatus.MISPLACED },
      include: { location: true },
      take: 50,
    });
    if (misplaced.length) {
      alerts.push({
        id: "devices_misplaced",
        severity: "low",
        category: "Inventory",
        title: `${misplaced.length} device${misplaced.length === 1 ? "" : "s"} misplaced`,
        detail: "Found during an audit, but not where the records said.",
        count: misplaced.length,
        items: misplaced.map((d) => ({
          label: `${d.type} ${d.model ?? ""}`.trim(),
          meta: d.location?.name ?? "",
          href: `/devices/${d.id}`,
        })),
      });
    }

    // 6. Purchase docs with unprocessed line items — low
    const docs = await this.prisma.purchaseDoc.findMany({
      where: { lineItems: { some: { reviewed: false } } },
      take: 20,
    });
    if (docs.length) {
      alerts.push({
        id: "procurement_pending",
        severity: "low",
        category: "Procurement",
        title: `${docs.length} purchase${docs.length === 1 ? "" : "s"} not yet in inventory`,
        detail: "Line items are entered but haven't been processed into device records.",
        count: docs.length,
        items: docs.map((d) => ({
          label: `${d.vendor} ${d.docType.toLowerCase()}${d.docNumber ? ` #${d.docNumber}` : ""}`,
          href: "/procurement",
        })),
      });
    }

    const summary = {
      high: alerts.filter((a) => a.severity === "high").length,
      medium: alerts.filter((a) => a.severity === "medium").length,
      low: alerts.filter((a) => a.severity === "low").length,
      total: alerts.length,
    };

    return { generatedAt: now, summary, digest: this.digest(alerts, summary), alerts };
  }

  private digest(alerts: Alert[], summary: { high: number; medium: number }): string {
    if (alerts.length === 0) return "All clear — nothing needs attention right now.";
    const find = (id: string) => alerts.find((a) => a.id === id);
    const parts: string[] = [];
    const slaBreached = find("sla_breached");
    const missing = find("devices_missing");
    const departed = find("departed_holding");
    const stuck = find("onboarding_stuck");
    const short = find("stock_shortfall");
    if (slaBreached) parts.push(`${slaBreached.count} ticket(s) past SLA`);
    if (missing) parts.push(`${missing.count} device(s) missing`);
    if (departed) parts.push(`${departed.count} to recover from departed staff`);
    if (stuck) parts.push(`${stuck.count} onboarding(s) overdue`);
    if (short) parts.push(`short ${short.count} device(s) for upcoming hires`);
    const head = `${summary.high} urgent, ${summary.medium} to watch.`;
    return parts.length ? `${head} ${parts.join(", ")}.` : head;
  }
}
