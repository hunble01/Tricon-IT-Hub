import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";
import {
  AssignOnboardingDevicesDto,
  StartOnboardingDto,
  UpdateOnboardingDto,
} from "./dto";
import { OnboardingService } from "./onboarding.service";

@Controller("onboarding")
export class OnboardingController {
  constructor(private readonly svc: OnboardingService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.svc.get(id);
  }

  @Get(":id/stock-suggestions")
  suggestStock(@Param("id") id: string) {
    return this.svc.suggestStock(id);
  }

  @Post("auto-provision-all")
  autoProvisionAll(@CurrentUser() actor: AuthenticatedUser) {
    return this.svc.autoProvisionAll(actor);
  }

  @Post(":id/auto-provision")
  autoProvision(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.autoProvision(id, actor);
  }

  @Post()
  start(@Body() dto: StartOnboardingDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.start(dto, actor);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateOnboardingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.update(id, dto, actor);
  }

  @Post(":id/assign-devices")
  assignDevices(
    @Param("id") id: string,
    @Body() dto: AssignOnboardingDevicesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.assignDevices(id, dto, actor);
  }
}
