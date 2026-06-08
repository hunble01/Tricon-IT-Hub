import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";
import { CompleteSiteAuditDto, StartSiteAuditDto } from "./dto";
import { SiteAuditService } from "./site-audit.service";

@Controller("site-audits")
export class SiteAuditController {
  constructor(private readonly svc: SiteAuditService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.svc.get(id);
  }

  @Post()
  start(@Body() dto: StartSiteAuditDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.start(dto, actor);
  }

  @Post(":id/complete")
  complete(
    @Param("id") id: string,
    @Body() dto: CompleteSiteAuditDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.complete(id, dto, actor);
  }
}
