import { Module } from "@nestjs/common";
import { DevicesModule } from "../devices/devices.module";
import { OnboardingModule } from "../onboarding/onboarding.module";
import { StaffModule } from "../staff/staff.module";
import { IntakeController } from "./intake.controller";
import { IntakeService } from "./intake.service";

@Module({
  imports: [OnboardingModule, DevicesModule, StaffModule],
  controllers: [IntakeController],
  providers: [IntakeService],
})
export class IntakeModule {}
