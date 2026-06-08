import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types";
import { PrismaService } from "../prisma/prisma.service";
import { CreateRoleDto, SetRoleDevicesDto, UpdateRoleDto } from "./dto";

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.role.findMany({
      orderBy: { title: "asc" },
      include: { deviceProfile: true },
    });
  }

  async get(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { deviceProfile: true },
    });
    if (!role) throw new NotFoundException("Role not found");
    return role;
  }

  async create(dto: CreateRoleDto, actor: AuthenticatedUser) {
    const created = await this.prisma.role.create({
      data: {
        title: dto.title,
        category: dto.category,
        isSharedDevice: dto.isSharedDevice ?? false,
        notes: dto.notes,
        deviceProfile: dto.devices
          ? {
              create: dto.devices.map((d) => ({
                deviceType: d.deviceType,
                quantity: d.quantity ?? 1,
              })),
            }
          : undefined,
      },
      include: { deviceProfile: true },
    });
    await this.audit.record({
      action: "role.create",
      userId: actor.userId,
      entityType: "Role",
      entityId: created.id,
      metadata: { title: created.title },
    });
    return created;
  }

  async update(id: string, dto: UpdateRoleDto, actor: AuthenticatedUser) {
    await this.get(id);
    const updated = await this.prisma.role.update({
      where: { id },
      data: dto,
      include: { deviceProfile: true },
    });
    await this.audit.record({
      action: "role.update",
      userId: actor.userId,
      entityType: "Role",
      entityId: id,
      metadata: { changes: dto as Record<string, unknown> },
    });
    return updated;
  }

  async setDevices(id: string, dto: SetRoleDevicesDto, actor: AuthenticatedUser) {
    await this.get(id);
    await this.prisma.$transaction([
      this.prisma.roleDeviceProfile.deleteMany({ where: { roleId: id } }),
      ...dto.devices.map((d) =>
        this.prisma.roleDeviceProfile.create({
          data: { roleId: id, deviceType: d.deviceType, quantity: d.quantity ?? 1 },
        }),
      ),
    ]);
    await this.audit.record({
      action: "role.devices.set",
      userId: actor.userId,
      entityType: "Role",
      entityId: id,
      metadata: { devices: dto.devices as unknown as Record<string, unknown> },
    });
    return this.get(id);
  }
}
