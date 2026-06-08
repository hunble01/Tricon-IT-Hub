import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AuthenticatedUser } from "../auth/types";
import { CreateRoleDto, SetRoleDevicesDto, UpdateRoleDto } from "./dto";
import { RolesService } from "./roles.service";

@Controller("roles")
export class RolesController {
  constructor(private readonly svc: RolesService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.svc.get(id);
  }

  @Post()
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateRoleDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.create(dto, actor);
  }

  @Patch(":id")
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN)
  update(
    @Param("id") id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.update(id, dto, actor);
  }

  @Put(":id/devices")
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN)
  setDevices(
    @Param("id") id: string,
    @Body() dto: SetRoleDevicesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.setDevices(id, dto, actor);
  }
}
