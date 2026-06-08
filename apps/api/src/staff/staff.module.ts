import { Module } from "@nestjs/common";
import { AdPrefixService } from "./ad-prefix.service";
import { StaffController } from "./staff.controller";
import { StaffMatcherService } from "./staff-matcher.service";
import { StaffService } from "./staff.service";

@Module({
  controllers: [StaffController],
  providers: [StaffService, StaffMatcherService, AdPrefixService],
  exports: [StaffService, StaffMatcherService, AdPrefixService],
})
export class StaffModule {}
