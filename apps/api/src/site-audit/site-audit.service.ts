import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DeviceStatus } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types";
import { PrismaService } from "../prisma/prisma.service";
import { CompleteSiteAuditDto, StartSiteAuditDto } from "./dto";

/**
 * Updates §6c — reconcile inventory records against physical reality at a site.
 * Flow: start an audit for a building → app lists what *should* be there →
 * agent marks each item found / not found → discrepancies update device status
 * (not found → MISSING, found-elsewhere → MISPLACED).
 */
@Injectable()
export class SiteAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const audits = await this.prisma.siteAudit.findMany({
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { _count: { select: { entries: true } } },
    });
    const buildings = await this.prisma.building.findMany({ select: { id: true, name: true } });
    const names = new Map(buildings.map((b) => [b.id, b.name]));
    return audits.map((a) => ({
      id: a.id,
      buildingId: a.buildingId,
      buildingName: names.get(a.buildingId) ?? null,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      notes: a.notes,
      entryCount: a._count.entries,
    }));
  }

  async start(dto: StartSiteAuditDto, actor: AuthenticatedUser) {
    const building = await this.prisma.building.findUnique({ where: { id: dto.buildingId } });
    if (!building) throw new BadRequestException("Unknown building");

    const audit = await this.prisma.siteAudit.create({
      data: { buildingId: dto.buildingId, performedById: actor.userId, notes: dto.notes },
    });
    await this.audit.record({
      action: "site_audit.start",
      userId: actor.userId,
      entityType: "SiteAudit",
      entityId: audit.id,
      metadata: { building: building.name },
    });
    return this.get(audit.id);
  }

  async get(id: string) {
    const audit = await this.prisma.siteAudit.findUnique({
      where: { id },
      include: { entries: true },
    });
    if (!audit) throw new NotFoundException("Audit not found");

    const building = await this.prisma.building.findUnique({ where: { id: audit.buildingId } });
    // Expected = everything the records say lives at this site (excludes retired).
    const expected = await this.prisma.device.findMany({
      where: { locationId: audit.buildingId, status: { not: DeviceStatus.RETIRED } },
      orderBy: [{ type: "asc" }, { model: "asc" }],
    });
    const byDevice = new Map(audit.entries.filter((e) => e.deviceId).map((e) => [e.deviceId!, e]));

    return {
      id: audit.id,
      buildingId: audit.buildingId,
      buildingName: building?.name ?? null,
      startedAt: audit.startedAt,
      completedAt: audit.completedAt,
      notes: audit.notes,
      expected: expected.map((d) => ({
        id: d.id,
        type: d.type,
        model: d.model,
        assetTag: d.assetTag,
        serialNumber: d.serialNumber,
        status: d.status,
        entry: byDevice.get(d.id) ?? null,
      })),
    };
  }

  async complete(id: string, dto: CompleteSiteAuditDto, actor: AuthenticatedUser) {
    const audit = await this.prisma.siteAudit.findUnique({ where: { id } });
    if (!audit) throw new NotFoundException("Audit not found");

    let found = 0;
    let missing = 0;
    let misplaced = 0;

    await this.prisma.$transaction(async (tx) => {
      // Idempotent: replace any prior entries for this audit.
      await tx.siteAuditEntry.deleteMany({ where: { siteAuditId: id } });

      for (const e of dto.entries) {
        let resultStatus: DeviceStatus | null = e.resultStatus ?? null;
        if (!e.found && !resultStatus) resultStatus = DeviceStatus.MISSING;

        await tx.siteAuditEntry.create({
          data: { siteAuditId: id, deviceId: e.deviceId, expected: true, found: e.found, resultStatus },
        });
        if (resultStatus) {
          await tx.device.update({ where: { id: e.deviceId }, data: { status: resultStatus } });
        }

        if (!e.found) missing++;
        else if (resultStatus === DeviceStatus.MISPLACED) misplaced++;
        else found++;
      }

      await tx.siteAudit.update({ where: { id }, data: { completedAt: new Date() } });
    });

    await this.audit.record({
      action: "site_audit.complete",
      userId: actor.userId,
      entityType: "SiteAudit",
      entityId: id,
      metadata: { found, missing, misplaced },
    });

    const detail = await this.get(id);
    return { ...detail, summary: { total: dto.entries.length, found, missing, misplaced } };
  }
}
