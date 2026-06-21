import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DeviceStatus,
  DeviceType,
  OnboardingDeviceStatus,
  Prisma,
  StaffSource,
} from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types";
import { PrismaService } from "../prisma/prisma.service";
import { AdPrefixService } from "../staff/ad-prefix.service";
import { splitName } from "../staff/name";
import { TasksService } from "../tasks/tasks.service";
import {
  AssignOnboardingDevicesDto,
  StartOnboardingDto,
  UpdateOnboardingDto,
} from "./dto";

const MONTH_FMT: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" };

/**
 * Recommended-device lists exist in two historical shapes: objects
 * `[{type, quantity}]` (from onboarding.start) and bare strings `["PHONE",…]`
 * (from the Excel importer). Normalize both to `{type, quantity}`.
 */
function normalizeRecommended(raw: unknown): Array<{ type: string; quantity: number }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) =>
      typeof d === "string"
        ? { type: d, quantity: 1 }
        : { type: (d as { type?: string })?.type ?? "", quantity: (d as { quantity?: number })?.quantity ?? 1 },
    )
    .filter((d) => typeof d.type === "string" && d.type.length > 0);
}

function monthLabelFor(date: Date): string {
  // Match the spec's Excel sheet style: "Jun. 2026".
  const short = date.toLocaleString("en-US", MONTH_FMT); // "Jun 2026"
  const [mon, year] = short.split(" ");
  return `${mon}. ${year}`;
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly adPrefix: AdPrefixService,
    private readonly tasks: TasksService,
  ) {}

  async list() {
    const rows = await this.prisma.onboarding.findMany({
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      include: {
        staff: { include: { role: true, building: true } },
        stockSource: true,
      },
    });
    // Group into a board keyed by monthLabel — newest month first.
    const groups: Record<string, typeof rows> = {};
    for (const r of rows) {
      const label = r.monthLabel ?? (r.startDate ? monthLabelFor(r.startDate) : "Undated");
      (groups[label] ??= []).push(r);
    }
    return Object.entries(groups).map(([label, items]) => ({ label, items }));
  }

  async get(id: string) {
    const o = await this.prisma.onboarding.findUnique({
      where: { id },
      include: {
        staff: {
          include: {
            role: { include: { deviceProfile: true } },
            building: true,
            devices: { include: { device: true } },
          },
        },
        stockSource: true,
      },
    });
    if (!o) throw new NotFoundException("Onboarding not found");
    return o;
  }

  async start(dto: StartOnboardingDto, actor: AuthenticatedUser) {
    const role = await this.prisma.role.findUnique({
      where: { id: dto.roleId },
      include: { deviceProfile: true },
    });
    if (!role) throw new BadRequestException("Unknown role");
    const building = await this.prisma.building.findUnique({ where: { id: dto.buildingId } });
    if (!building) throw new BadRequestException("Unknown building");

    const parts = splitName(dto.fullName);
    if (!parts) throw new BadRequestException("Invalid name");

    const { suggestion: adPrefix } = await this.adPrefix.suggest(
      parts.firstName,
      parts.lastName,
    );

    const startDate = dto.startDate ? new Date(dto.startDate) : null;
    const monthLabel = startDate
      ? monthLabelFor(startDate)
      : monthLabelFor(new Date());

    const recommendedDevices = role.deviceProfile.map((d) => ({
      type: d.deviceType,
      quantity: d.quantity,
    }));

    const staff = await this.prisma.staff.create({
      data: {
        fullName: parts.fullName,
        firstName: parts.firstName,
        lastName: parts.lastName,
        adPrefix,
        roleId: role.id,
        buildingId: building.id,
        startDate,
        employmentStatus: "ONBOARDING",
        source: StaffSource.ONBOARDING,
      },
    });

    const onboarding = await this.prisma.onboarding.create({
      data: {
        staffId: staff.id,
        stockSourceId: dto.stockSourceId ?? null,
        startDate,
        recommendedDevices: recommendedDevices as unknown as Prisma.InputJsonValue,
        monthLabel,
        assignedTech: dto.assignedTech,
        notes: dto.notes,
      },
    });

    await this.audit.record({
      action: "onboarding.start",
      userId: actor.userId,
      entityType: "Onboarding",
      entityId: onboarding.id,
      metadata: {
        staffId: staff.id,
        staffName: staff.fullName,
        roleTitle: role.title,
        buildingName: building.name,
      },
    });

    // Task-source: seed the todo board with the hands-on work a new hire needs.
    await this.tasks.generate(
      [
        {
          sourceKey: `onboarding:${onboarding.id}:provision`,
          source: "ONBOARDING",
          type: "SETUP",
          title: `Provision accounts for ${staff.fullName}`,
          description: `Create AD account (${adPrefix}) and M365 mailbox/licences for ${role.title} at ${building.name}.`,
          staffId: staff.id,
          buildingId: building.id,
          dueDate: startDate,
        },
        {
          sourceKey: `onboarding:${onboarding.id}:devices`,
          source: "ONBOARDING",
          type: "ASSIGN_DEVICE",
          title: `Assign & deliver devices to ${staff.fullName}`,
          description: `Prep and hand off the ${role.title} device kit at ${building.name}.`,
          staffId: staff.id,
          buildingId: building.id,
          dueDate: startDate,
        },
      ],
      actor,
    );

    return this.get(onboarding.id);
  }

  async update(id: string, dto: UpdateOnboardingDto, actor: AuthenticatedUser) {
    await this.get(id);
    const data: Prisma.OnboardingUpdateInput = {
      adDone: dto.adDone,
      badgeDone: dto.badgeDone,
      hardwareDone: dto.hardwareDone,
      softwareDone: dto.softwareDone,
      deviceStatus: dto.deviceStatus,
      assignedTech: dto.assignedTech,
      notes: dto.notes,
    };
    if (dto.stockSourceId !== undefined) {
      data.stockSource = dto.stockSourceId
        ? { connect: { id: dto.stockSourceId } }
        : { disconnect: true };
    }
    const updated = await this.prisma.onboarding.update({ where: { id }, data });
    await this.audit.record({
      action: "onboarding.update",
      userId: actor.userId,
      entityType: "Onboarding",
      entityId: id,
      metadata: { changes: dto as unknown as Record<string, unknown> },
    });
    return this.get(updated.id);
  }

  async assignDevices(
    id: string,
    dto: AssignOnboardingDevicesDto,
    actor: AuthenticatedUser,
  ) {
    const o = await this.get(id);
    const staffId = o.staffId;

    await this.prisma.$transaction(async (tx) => {
      for (const a of dto.assignments) {
        const dev = await tx.device.findUnique({
          where: { id: a.deviceId },
          include: { assignments: { where: { returnedAt: null }, take: 1 } },
        });
        if (!dev) throw new BadRequestException(`Device ${a.deviceId} not found`);
        if (dev.assignments.length > 0) {
          throw new BadRequestException(
            `Device ${dev.assetTag ?? dev.id} already assigned`,
          );
        }
        await tx.deviceAssignment.create({
          data: {
            deviceId: dev.id,
            staffId,
            assignedById: actor.userId,
            notes: `Onboarding ${o.id}`,
          },
        });
        await tx.device.update({
          where: { id: dev.id },
          data: {
            status: DeviceStatus.ASSIGNED,
            locationId: o.staff.buildingId ?? dev.locationId ?? null,
          },
        });
      }
      await tx.onboarding.update({
        where: { id },
        data: {
          deviceStatus: OnboardingDeviceStatus.DONE,
          hardwareDone: true,
        },
      });
    });

    await this.audit.record({
      action: "onboarding.devices.assign",
      userId: actor.userId,
      entityType: "Onboarding",
      entityId: id,
      metadata: {
        staffId,
        deviceIds: dto.assignments.map((a) => a.deviceId),
      },
    });

    return this.get(id);
  }

  /**
   * Autopilot: automatically reserve the recommended devices from in-stock
   * inventory (preferring the stock-source / building location), filling only
   * the gap vs. what's already assigned. Reports any shortfall to order.
   */
  async autoProvision(id: string, actor: AuthenticatedUser) {
    const o = await this.get(id);
    const recommended = normalizeRecommended(o.recommendedDevices);

    // What the new hire already holds (open assignments), counted by type.
    const have: Record<string, number> = {};
    for (const a of o.staff.devices) {
      if (!a.returnedAt) have[a.device.type] = (have[a.device.type] ?? 0) + 1;
    }

    const preferLoc = o.stockSourceId ?? o.staff.buildingId ?? null;
    const validTypes = new Set<string>(Object.values(DeviceType));
    const assigned: Array<{ type: string; assigned: number; assetTags: string[] }> = [];
    const shortfalls: Array<{ type: string; needed: number; assigned: number }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const rec of recommended) {
        if (!rec?.type || !validTypes.has(rec.type)) continue; // skip unknown device types
        const need = Math.max(0, rec.quantity - (have[rec.type] ?? 0));
        if (need === 0) continue;

        const candidates = await tx.device.findMany({
          where: {
            status: DeviceStatus.IN_STOCK,
            type: rec.type as DeviceType,
            assignments: { none: { returnedAt: null } },
          },
          take: need + 12,
          orderBy: { createdAt: "asc" },
        });
        // Prefer devices already at the target location.
        const ranked = candidates
          .map((d) => ({ d, score: d.locationId === preferLoc ? 2 : d.locationId == null ? 1 : 0 }))
          .sort((a, b) => b.score - a.score)
          .slice(0, need)
          .map((x) => x.d);

        const tags: string[] = [];
        for (const dev of ranked) {
          await tx.deviceAssignment.create({
            data: {
              deviceId: dev.id,
              staffId: o.staffId,
              assignedById: actor.userId,
              notes: `Auto-provisioned · onboarding ${o.id}`,
            },
          });
          await tx.device.update({
            where: { id: dev.id },
            data: {
              status: DeviceStatus.ASSIGNED,
              locationId: o.staff.buildingId ?? dev.locationId ?? null,
            },
          });
          tags.push(dev.assetTag ?? dev.serialNumber ?? dev.id.slice(0, 8));
        }

        if (ranked.length > 0) assigned.push({ type: rec.type, assigned: ranked.length, assetTags: tags });
        if (ranked.length < need) shortfalls.push({ type: rec.type, needed: need, assigned: ranked.length });
      }

      const validRecs = recommended.filter((rec) => rec?.type && validTypes.has(rec.type));
      const fullyProvisioned =
        validRecs.length > 0 &&
        validRecs.every(
          (rec) =>
            (have[rec.type] ?? 0) + (assigned.find((a) => a.type === rec.type)?.assigned ?? 0) >=
            rec.quantity,
        );

      await tx.onboarding.update({
        where: { id },
        data: {
          deviceStatus: fullyProvisioned ? OnboardingDeviceStatus.DONE : undefined,
          hardwareDone: fullyProvisioned ? true : undefined,
        },
      });
    });

    const totalAssigned = assigned.reduce((n, a) => n + a.assigned, 0);
    await this.audit.record({
      action: "onboarding.autoprovision",
      userId: actor.userId,
      entityType: "Onboarding",
      entityId: id,
      metadata: { assigned: totalAssigned, shortfalls: shortfalls.length },
    });

    return {
      assigned,
      shortfalls,
      totalAssigned,
      fullyProvisioned: shortfalls.length === 0 && (recommended.length === 0 || totalAssigned > 0),
    };
  }

  /** Run autopilot across every onboarding whose devices are still pending. */
  async autoProvisionAll(actor: AuthenticatedUser) {
    const pending = await this.prisma.onboarding.findMany({
      where: { deviceStatus: OnboardingDeviceStatus.PENDING },
      select: { id: true },
    });

    let devicesAssigned = 0;
    let fullyProvisioned = 0;
    let partial = 0;
    const shortByType: Record<string, number> = {};

    for (const p of pending) {
      const r = await this.autoProvision(p.id, actor);
      devicesAssigned += r.totalAssigned;
      if (r.totalAssigned > 0 && r.shortfalls.length === 0) fullyProvisioned++;
      else if (r.totalAssigned > 0) partial++;
      for (const s of r.shortfalls) {
        shortByType[s.type] = (shortByType[s.type] ?? 0) + (s.needed - s.assigned);
      }
    }

    return {
      onboardingsProcessed: pending.length,
      devicesAssigned,
      fullyProvisioned,
      partial,
      shortByType,
    };
  }

  /** Suggest IN_STOCK devices of the recommended types for this onboarding. */
  async suggestStock(id: string) {
    const o = await this.get(id);
    const validTypes = new Set<string>(Object.values(DeviceType));
    const recommendedTypes = normalizeRecommended(o.recommendedDevices)
      .map((d) => d.type)
      .filter((t) => validTypes.has(t)) as DeviceType[];

    if (recommendedTypes.length === 0) return [];

    const devices = await this.prisma.device.findMany({
      where: {
        status: DeviceStatus.IN_STOCK,
        type: { in: recommendedTypes },
        OR: [{ locationId: o.stockSourceId ?? undefined }, { locationId: null }],
      },
      include: { location: true },
      orderBy: [{ type: "asc" }],
    });

    // Group by type for the UI.
    const grouped = recommendedTypes.map((t) => ({
      type: t,
      candidates: devices.filter((d) => d.type === t),
    }));
    return grouped;
  }
}
