import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Task, TaskSource, TaskStatus, TaskType } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTaskDto, ListTasksQueryDto, UpdateTaskDto } from "./dto";

/** A task to generate from a source flow. Upserted idempotently by sourceKey. */
export interface TaskSpec {
  sourceKey: string;
  source: TaskSource;
  type: TaskType;
  title: string;
  description?: string;
  staffId?: string;
  deviceId?: string;
  buildingId?: string;
  ticketId?: string;
  dueDate?: Date | null;
}

const OPEN_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED"];

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- reads ---------------------------------------------------------

  async list(query: ListTasksQueryDto = {}) {
    const where: Prisma.TaskWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.source) where.source = query.source;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.buildingId) where.buildingId = query.buildingId;
    if (query.staffId) where.staffId = query.staffId;
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: "insensitive" } },
        { description: { contains: query.q, mode: "insensitive" } },
      ];
    }

    const rows = await this.prisma.task.findMany({
      where,
      orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    });
    return this.enrich(rows);
  }

  async get(id: string) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException("Task not found");
    return (await this.enrich([task]))[0];
  }

  /** Counts for the board header: per-status, plus overdue (open + past due). */
  async stats() {
    const grouped = await this.prisma.task.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    for (const g of grouped) byStatus[g.status] = g._count._all;

    const overdue = await this.prisma.task.count({
      where: { status: { in: OPEN_STATUSES }, dueDate: { lt: new Date() } },
    });
    const open = OPEN_STATUSES.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);
    return { byStatus, open, overdue, total: Object.values(byStatus).reduce((a, b) => a + b, 0) };
  }

  // ---- writes --------------------------------------------------------

  async create(dto: CreateTaskDto, actor: AuthenticatedUser) {
    const task = await this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        type: dto.type ?? "OTHER",
        priority: dto.priority ?? "NORMAL",
        source: dto.source ?? "MANUAL",
        staffId: dto.staffId,
        deviceId: dto.deviceId,
        buildingId: dto.buildingId,
        ticketId: dto.ticketId,
        assigneeId: dto.assigneeId ?? actor.userId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        createdById: actor.userId,
      },
    });
    await this.audit.record({
      action: "task.create",
      userId: actor.userId,
      entityType: "Task",
      entityId: task.id,
      metadata: { title: task.title, type: task.type, source: task.source },
    });
    return this.get(task.id);
  }

  async update(id: string, dto: UpdateTaskDto, actor: AuthenticatedUser) {
    await this.ensureExists(id);
    const completing = dto.status === "DONE";
    const reopening = dto.status && dto.status !== "DONE";

    const task = await this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        type: dto.type,
        status: dto.status,
        priority: dto.priority,
        staffId: dto.staffId,
        deviceId: dto.deviceId,
        buildingId: dto.buildingId,
        ticketId: dto.ticketId,
        assigneeId: dto.assigneeId,
        dueDate: dto.dueDate === undefined ? undefined : dto.dueDate ? new Date(dto.dueDate) : null,
        completedAt: completing ? new Date() : reopening ? null : undefined,
      },
    });
    await this.audit.record({
      action: "task.update",
      userId: actor.userId,
      entityType: "Task",
      entityId: id,
      metadata: { changes: dto as unknown as Record<string, unknown> },
    });
    return this.get(task.id);
  }

  async remove(id: string, actor: AuthenticatedUser) {
    await this.ensureExists(id);
    await this.prisma.task.delete({ where: { id } });
    await this.audit.record({
      action: "task.delete",
      userId: actor.userId,
      entityType: "Task",
      entityId: id,
    });
    return { deleted: true };
  }

  // ---- task-source generation ---------------------------------------

  /**
   * Upsert a batch of generated tasks by their sourceKey, so re-running a
   * generator never duplicates work. Returns the created/updated tasks. Closed
   * tasks (DONE/CANCELLED) are left alone — we don't resurrect finished work.
   */
  async generate(specs: TaskSpec[], actor: AuthenticatedUser | null): Promise<Task[]> {
    const out: Task[] = [];
    for (const spec of specs) {
      const existing = await this.prisma.task.findUnique({ where: { sourceKey: spec.sourceKey } });
      if (existing && (existing.status === "DONE" || existing.status === "CANCELLED")) {
        out.push(existing);
        continue;
      }
      const task = await this.prisma.task.upsert({
        where: { sourceKey: spec.sourceKey },
        create: {
          sourceKey: spec.sourceKey,
          source: spec.source,
          type: spec.type,
          title: spec.title,
          description: spec.description,
          staffId: spec.staffId,
          deviceId: spec.deviceId,
          buildingId: spec.buildingId,
          ticketId: spec.ticketId,
          dueDate: spec.dueDate ?? null,
          createdById: actor?.userId ?? null,
        },
        update: {
          title: spec.title,
          description: spec.description,
          dueDate: spec.dueDate ?? null,
        },
      });
      out.push(task);
    }
    if (out.length) {
      await this.audit.record({
        action: "task.generate",
        userId: actor?.userId ?? null,
        entityType: "Task",
        metadata: { source: specs[0]?.source, count: out.length },
      });
    }
    return out;
  }

  // ---- internals -----------------------------------------------------

  private async ensureExists(id: string) {
    const exists = await this.prisma.task.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Task not found");
  }

  /** Resolve the plain id refs into lightweight summaries for the UI. */
  private async enrich(tasks: Task[]) {
    const ids = (key: keyof Task) =>
      [...new Set(tasks.map((t) => t[key]).filter((v): v is string => !!v))];

    const [staff, devices, buildings, users] = await Promise.all([
      this.prisma.staff.findMany({
        where: { id: { in: ids("staffId") } },
        select: { id: true, fullName: true },
      }),
      this.prisma.device.findMany({
        where: { id: { in: ids("deviceId") } },
        select: { id: true, type: true, model: true, assetTag: true },
      }),
      this.prisma.building.findMany({
        where: { id: { in: ids("buildingId") } },
        select: { id: true, name: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: ids("assigneeId") } },
        select: { id: true, name: true },
      }),
    ]);

    const byId = <T extends { id: string }>(rows: T[]) =>
      Object.fromEntries(rows.map((r) => [r.id, r]));
    const staffMap = byId(staff);
    const deviceMap = byId(devices);
    const buildingMap = byId(buildings);
    const userMap = byId(users);
    const now = Date.now();

    return tasks.map((t) => ({
      ...t,
      overdue:
        !!t.dueDate && OPEN_STATUSES.includes(t.status) && t.dueDate.getTime() < now,
      staff: t.staffId ? staffMap[t.staffId] ?? null : null,
      device: t.deviceId ? deviceMap[t.deviceId] ?? null : null,
      building: t.buildingId ? buildingMap[t.buildingId] ?? null : null,
      assignee: t.assigneeId ? userMap[t.assigneeId] ?? null : null,
    }));
  }
}
