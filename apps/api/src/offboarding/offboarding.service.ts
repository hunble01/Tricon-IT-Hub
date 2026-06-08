import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DeviceStatus,
  EmploymentStatus,
  OffboardingStatus,
} from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types";
import { PrismaService } from "../prisma/prisma.service";
import { StartOffboardingDto, UpdateOffboardingDto } from "./dto";

const MONTH_FMT: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" };

function monthLabelFor(date: Date): string {
  const short = date.toLocaleString("en-US", MONTH_FMT); // "Jun 2026"
  const [mon, year] = short.split(" ");
  return `${mon}. ${year}`;
}

/**
 * Phase 2 — offboarding pipeline. The counterpart to onboarding: walk a
 * departing hire through reclaiming gear, disabling AD, returning the badge,
 * and revoking software. Closes the chain-of-custody loop the inventory work
 * opened — every device a leaver holds is returned to stock here.
 */
@Injectable()
export class OffboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.prisma.offboarding.findMany({
      orderBy: [{ lastDay: "desc" }, { createdAt: "desc" }],
      include: {
        staff: {
          include: {
            role: true,
            building: true,
            devices: { where: { returnedAt: null }, include: { device: true } },
          },
        },
      },
    });
    // Group into a board keyed by monthLabel — soonest/newest month first.
    const groups: Record<string, typeof rows> = {};
    for (const r of rows) {
      const label = r.monthLabel ?? (r.lastDay ? monthLabelFor(r.lastDay) : "Undated");
      (groups[label] ??= []).push(r);
    }
    return Object.entries(groups).map(([label, items]) => ({ label, items }));
  }

  async get(id: string) {
    const o = await this.prisma.offboarding.findUnique({
      where: { id },
      include: {
        staff: {
          include: {
            role: true,
            building: true,
            devices: { where: { returnedAt: null }, include: { device: true } },
          },
        },
      },
    });
    if (!o) throw new NotFoundException("Offboarding not found");
    return o;
  }

  async start(dto: StartOffboardingDto, actor: AuthenticatedUser) {
    const staff = await this.prisma.staff.findUnique({ where: { id: dto.staffId } });
    if (!staff) throw new BadRequestException("Unknown staff member");

    const existing = await this.prisma.offboarding.findUnique({
      where: { staffId: dto.staffId },
    });
    if (existing) throw new BadRequestException("This person already has an offboarding");

    const lastDay = dto.lastDay ? new Date(dto.lastDay) : null;
    const monthLabel = monthLabelFor(lastDay ?? new Date());

    const offboarding = await this.prisma.offboarding.create({
      data: {
        staffId: staff.id,
        lastDay,
        monthLabel,
        assignedTech: dto.assignedTech,
        reason: dto.reason,
        notes: dto.notes,
        status: OffboardingStatus.PENDING,
      },
    });

    await this.audit.record({
      action: "offboarding.start",
      userId: actor.userId,
      entityType: "Offboarding",
      entityId: offboarding.id,
      metadata: { staffId: staff.id, staffName: staff.fullName, reason: dto.reason },
    });

    return this.get(offboarding.id);
  }

  async update(id: string, dto: UpdateOffboardingDto, actor: AuthenticatedUser) {
    const current = await this.get(id);

    const updated = await this.prisma.offboarding.update({
      where: { id },
      data: {
        adDisabled: dto.adDisabled,
        badgeReturned: dto.badgeReturned,
        hardwareReturned: dto.hardwareReturned,
        accountsRevoked: dto.accountsRevoked,
        status: dto.status,
        assignedTech: dto.assignedTech,
        reason: dto.reason,
        notes: dto.notes,
      },
    });

    // Completing an offboarding marks the staff member DEPARTED.
    if (dto.status === OffboardingStatus.COMPLETED) {
      await this.prisma.staff.update({
        where: { id: current.staffId },
        data: { employmentStatus: EmploymentStatus.DEPARTED },
      });
    }

    await this.audit.record({
      action: "offboarding.update",
      userId: actor.userId,
      entityType: "Offboarding",
      entityId: id,
      metadata: { changes: dto as unknown as Record<string, unknown> },
    });

    return this.get(updated.id);
  }

  /**
   * Autopilot: return every device the departing staff member still holds back
   * to stock in one action, closing each open assignment and stamping the
   * custody trail. Reports what was reclaimed so the agent can confirm.
   */
  async reclaimDevices(id: string, actor: AuthenticatedUser) {
    const o = await this.get(id);

    const open = await this.prisma.deviceAssignment.findMany({
      where: { staffId: o.staffId, returnedAt: null },
      include: { device: true },
    });

    const reclaimed: Array<{ deviceId: string; label: string; assetTag: string | null }> = [];

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      for (const a of open) {
        await tx.deviceAssignment.update({
          where: { id: a.id },
          data: { returnedAt: now, notes: `Reclaimed · offboarding ${o.id}` },
        });
        await tx.device.update({
          where: { id: a.deviceId },
          data: { status: DeviceStatus.IN_STOCK },
        });
        reclaimed.push({
          deviceId: a.deviceId,
          label: `${a.device.type} ${a.device.model ?? ""}`.trim(),
          assetTag: a.device.assetTag,
        });
      }
      await tx.offboarding.update({
        where: { id },
        data: {
          hardwareReturned: reclaimed.length > 0 ? true : o.hardwareReturned,
          status: o.status === OffboardingStatus.PENDING ? OffboardingStatus.IN_PROGRESS : o.status,
        },
      });
    });

    await this.audit.record({
      action: "offboarding.reclaim",
      userId: actor.userId,
      entityType: "Offboarding",
      entityId: id,
      metadata: { staffId: o.staffId, reclaimed: reclaimed.length, deviceIds: reclaimed.map((r) => r.deviceId) },
    });

    return { reclaimed, count: reclaimed.length };
  }

  /** Eligible leavers: active staff who don't already have an offboarding. */
  async candidates() {
    return this.prisma.staff.findMany({
      where: {
        employmentStatus: { in: [EmploymentStatus.ACTIVE, EmploymentStatus.NO_SHOW] },
        offboarding: null,
      },
      include: { role: true, building: true },
      orderBy: { fullName: "asc" },
    });
  }
}
