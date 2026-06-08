import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { DeviceStatus, DeviceType } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";
import { DevicesService } from "./devices.service";
import {
  AssignDeviceDto,
  CreateDeviceDto,
  ReturnDeviceDto,
  UpdateDeviceDto,
} from "./dto";

@Controller("devices")
export class DevicesController {
  constructor(private readonly svc: DevicesService) {}

  @Get()
  list(
    @Query("type") type?: DeviceType,
    @Query("status") status?: DeviceStatus,
    @Query("locationId") locationId?: string,
    @Query("q") q?: string,
  ) {
    return this.svc.list({ type, status, locationId, q });
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body() dto: CreateDeviceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.create(dto, actor);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateDeviceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.update(id, dto, actor);
  }

  @Post(":id/assign")
  assign(
    @Param("id") id: string,
    @Body() dto: AssignDeviceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.assign(id, dto, actor);
  }

  @Post(":id/return")
  return(
    @Param("id") id: string,
    @Body() dto: ReturnDeviceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.return(id, dto, actor);
  }
}
