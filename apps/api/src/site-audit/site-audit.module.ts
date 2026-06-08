import { Module } from "@nestjs/common";
import { SiteAuditController } from "./site-audit.controller";
import { SiteAuditService } from "./site-audit.service";

@Module({
  controllers: [SiteAuditController],
  providers: [SiteAuditService],
})
export class SiteAuditModule {}
