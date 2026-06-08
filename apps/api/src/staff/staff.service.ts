import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Staff, StaffSource } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types";
import { PrismaService } from "../prisma/prisma.service";
import { AdPrefixService } from "./ad-prefix.service";
import { CreateStaffDto, UpdateStaffDto } from "./dto";
import { splitName } from "./name";

export interface ListStaffOpts {
  buildingId?: string;
  source?: StaffSource;
  q?: string;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly adPrefix: AdPrefixService,
  ) {}

  list(opts: ListStaffOpts = {}) {
    const where: Prisma.StaffWhereInput = {};
    if (opts.buildingId) where.buildingId = opts.buildingId;
    if (opts.source) where.source = opts.source;
    if (opts.q) {
      where.OR = [
        { fullName: { contains: opts.q, mode: "insensitive" } },
        { adPrefix: { contains: opts.q, mode: "insensitive" } },
        { email: { contains: opts.q, mode: "insensitive" } },
      ];
    }
    return this.prisma.staff.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      include: { role: true, building: true },
    });
  }

  async get(id: string) {
    const s = await this.prisma.staff.findUnique({
      where: { id },
      include: {
        role: { include: { deviceProfile: true } },
        building: true,
        onboarding: true,
        devices: {
          include: { device: true },
          orderBy: { assignedAt: "desc" },
        },
        tickets: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!s) throw new NotFoundException("Staff not found");
    return s;
  }

  async create(dto: CreateStaffDto, actor: AuthenticatedUser): Promise<Staff> {
    const parts = splitName(dto.fullName);
    const firstName = dto.firstName ?? parts?.firstName ?? "";
    const lastName = dto.lastName ?? parts?.lastName ?? "";

    let adPrefix = dto.adPrefix?.trim() || null;
    if (!adPrefix && firstName && lastName) {
      const { suggestion } = await this.adPrefix.suggest(firstName, lastName);
      adPrefix = suggestion || null;
    }

    const created = await this.prisma.staff.create({
      data: {
        fullName: dto.fullName.trim(),
        firstName,
        lastName,
        adPrefix,
        roleId: dto.roleId ?? null,
        buildingId: dto.buildingId ?? null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        employmentStatus: dto.employmentStatus,
        email: dto.email,
        phone: dto.phone,
        source: dto.source ?? StaffSource.MANUAL,
        notes: dto.notes,
      },
    });

    await this.audit.record({
      action: "staff.create",
      userId: actor.userId,
      entityType: "Staff",
      entityId: created.id,
      metadata: { fullName: created.fullName, source: created.source },
    });

    return created;
  }

  async update(id: string, dto: UpdateStaffDto, actor: AuthenticatedUser): Promise<Staff> {
    await this.get(id);
    const data: Prisma.StaffUpdateInput = {
      adPrefix: dto.adPrefix,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      employmentStatus: dto.employmentStatus,
      email: dto.email,
      phone: dto.phone,
      notes: dto.notes,
    };
    if (dto.roleId !== undefined) {
      data.role = dto.roleId ? { connect: { id: dto.roleId } } : { disconnect: true };
    }
    if (dto.buildingId !== undefined) {
      data.building = dto.buildingId
        ? { connect: { id: dto.buildingId } }
        : { disconnect: true };
    }
    const updated = await this.prisma.staff.update({ where: { id }, data });
    await this.audit.record({
      action: "staff.update",
      userId: actor.userId,
      entityType: "Staff",
      entityId: id,
      metadata: { changes: dto as unknown as Record<string, unknown> },
    });
    return updated;
  }
}
