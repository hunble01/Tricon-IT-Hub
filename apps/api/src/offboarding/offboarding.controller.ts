import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";
import { StartOffboardingDto, UpdateOffboardingDto } from "./dto";
import { OffboardingService } from "./offboarding.service";

@Controller("offboarding")
export class OffboardingController {
  constructor(private readonly svc: OffboardingService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get("candidates")
  candidates() {
    return this.svc.candidates();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.svc.get(id);
  }

  @Post()
  start(@Body() dto: StartOffboardingDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.start(dto, actor);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateOffboardingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.update(id, dto, actor);
  }

  @Post(":id/reclaim")
  reclaim(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.reclaimDevices(id, actor);
  }
}
