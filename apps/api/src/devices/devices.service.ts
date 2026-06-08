import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DeviceStatus,
  DeviceType,
  Prisma,
} from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types";
import { PrismaService } from "../prisma/prisma.service";
import {
  AssignDeviceDto,
  CreateDeviceDto,
  ReturnDeviceDto,
  UpdateDeviceDto,
} from "./dto";

export interface ListDevicesOpts {
  type?: DeviceType;
  status?: DeviceStatus;
  locationId?: string;
  q?: string;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(opts: ListDevicesOpts = {}) {
    const where: Prisma.DeviceWhereInput = {};
    if (opts.type) where.type = opts.type;
    if (opts.status) where.status = opts.status;
    if (opts.locationId) where.locationId = opts.locationId;
    if (opts.q) {
      where.OR = [
        { assetTag: { contains: opts.q, mode: "insensitive" } },
        { serialNumber: { contains: opts.q, mode: "insensitive" } },
        { model: { contains: opts.q, mode: "insensitive" } },
      ];
    }
    return this.prisma.device.findMany({
      where,
      orderBy: [{ status: "asc" }, { type: "asc" }],
      include: {
        location: true,
        assignments: {
          where: { returnedAt: null },
          include: { staff: { select: { id: true, fullName: true } } },
          take: 1,
        },
      },
    });
  }

  async get(id: string) {
    const d = await this.prisma.device.findUnique({
      where: { id },
      include: {
        location: true,
        assignments: {
          orderBy: { assignedAt: "desc" },
          include: { staff: { select: { id: true, fullName: true, buildingId: true } } },
        },
      },
    });
    if (!d) throw new NotFoundException("Device not found");
    return d;
  }

  async create(dto: CreateDeviceDto, actor: AuthenticatedUser) {
    const created = await this.prisma.device.create({ data: dto });
    await this.audit.record({
      action: "device.create",
      userId: actor.userId,
      entityType: "Device",
      entityId: created.id,
      metadata: { type: created.type, assetTag: created.assetTag },
    });
    return created;
  }

  async update(id: string, dto: UpdateDeviceDto, actor: AuthenticatedUser) {
    await this.get(id);
    const data: Prisma.DeviceUpdateInput = {
      assetTag: dto.assetTag,
      serialNumber: dto.serialNumber,
      model: dto.model,
      status: dto.status,
      notes: dto.notes,
    };
    if (dto.locationId !== undefined) {
      data.location = dto.locationId
        ? { connect: { id: dto.locationId } }
        : { disconnect: true };
    }
    const updated = await this.prisma.device.update({ where: { id }, data });
    await this.audit.record({
      action: "device.update",
      userId: actor.userId,
      entityType: "Device",
      entityId: id,
      metadata: { changes: dto as unknown as Record<string, unknown> },
    });
    return updated;
  }

  async assign(deviceId: string, dto: AssignDeviceDto, actor: AuthenticatedUser) {
    const device = await this.get(deviceId);
    if (device.status === DeviceStatus.RETIRED) {
      throw new BadRequestException("Device is retired and cannot be assigned");
    }
    const openAssignment = device.assignments.find((a) => a.returnedAt == null);
    if (openAssignment) {
      throw new BadRequestException(
        `Device is currently assigned to ${openAssignment.staff.fullName} — return it first.`,
      );
    }
    const staff = await this.prisma.staff.findUnique({
      where: { id: dto.staffId },
      select: { id: true, fullName: true, buildingId: true },
    });
    if (!staff) throw new BadRequestException("Staff not found");

    const [assignment] = await this.prisma.$transaction([
      this.prisma.deviceAssignment.create({
        data: {
          deviceId,
          staffId: dto.staffId,
          assignedById: actor.userId,
          notes: dto.notes,
        },
      }),
      this.prisma.device.update({
        where: { id: deviceId },
        data: {
          status: DeviceStatus.ASSIGNED,
          locationId: staff.buildingId ?? device.locationId ?? null,
        },
      }),
    ]);

    await this.audit.record({
      action: "device.assign",
      userId: actor.userId,
      entityType: "Device",
      entityId: deviceId,
      metadata: { staffId: dto.staffId, staffName: staff.fullName, assignmentId: assignment.id },
    });

    return this.get(deviceId);
  }

  async return(deviceId: string, dto: ReturnDeviceDto, actor: AuthenticatedUser) {
    const device = await this.get(deviceId);
    const open = device.assignments.find((a) => a.returnedAt == null);
    if (!open) throw new BadRequestException("Device is not currently assigned");

    await this.prisma.$transaction([
      this.prisma.deviceAssignment.update({
        where: { id: open.id },
        data: { returnedAt: new Date(), notes: dto.notes ?? open.notes },
      }),
      this.prisma.device.update({
        where: { id: deviceId },
        data: {
          status: DeviceStatus.RETURNED,
          locationId: dto.returnedToLocationId ?? device.locationId ?? null,
        },
      }),
    ]);

    await this.audit.record({
      action: "device.return",
      userId: actor.userId,
      entityType: "Device",
      entityId: deviceId,
      metadata: {
        staffId: open.staff.id,
        staffName: open.staff.fullName,
        assignmentId: open.id,
      },
    });

    return this.get(deviceId);
  }
}
