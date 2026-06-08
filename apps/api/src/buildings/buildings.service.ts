import { Injectable, NotFoundException } from "@nestjs/common";
import { Building } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { CreateBuildingDto, UpdateBuildingDto } from "./dto";

@Injectable()
export class BuildingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<Building[]> {
    return this.prisma.building.findMany({ orderBy: { name: "asc" } });
  }

  async get(id: string): Promise<Building> {
    const b = await this.prisma.building.findUnique({ where: { id } });
    if (!b) throw new NotFoundException("Building not found");
    return b;
  }

  async create(dto: CreateBuildingDto, actor: AuthenticatedUser): Promise<Building> {
    const created = await this.prisma.building.create({ data: dto });
    await this.audit.record({
      action: "building.create",
      userId: actor.userId,
      entityType: "Building",
      entityId: created.id,
      metadata: { name: created.name },
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateBuildingDto,
    actor: AuthenticatedUser,
  ): Promise<Building> {
    await this.get(id);
    const updated = await this.prisma.building.update({ where: { id }, data: dto });
    await this.audit.record({
      action: "building.update",
      userId: actor.userId,
      entityType: "Building",
      entityId: id,
      metadata: { changes: dto as Record<string, unknown> },
    });
    return updated;
  }
}
