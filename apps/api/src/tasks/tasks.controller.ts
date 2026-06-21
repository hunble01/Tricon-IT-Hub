import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";
import { CreateTaskDto, ListTasksQueryDto, UpdateTaskDto } from "./dto";
import { TasksService } from "./tasks.service";

@Controller("tasks")
export class TasksController {
  constructor(private readonly svc: TasksService) {}

  @Get()
  list(@Query() query: ListTasksQueryDto) {
    return this.svc.list(query);
  }

  @Get("stats")
  stats() {
    return this.svc.stats();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body() dto: CreateTaskDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.create(dto, actor);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.update(id, dto, actor);
  }

  @Post(":id/calendar")
  syncToCalendar(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.syncToCalendar(id, actor);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.remove(id, actor);
  }
}
