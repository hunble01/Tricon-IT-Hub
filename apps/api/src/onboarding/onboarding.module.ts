import { Module } from "@nestjs/common";
import { StaffModule } from "../staff/staff.module";
import { TasksModule } from "../tasks/tasks.module";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";

@Module({
  imports: [StaffModule, TasksModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
