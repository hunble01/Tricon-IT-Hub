import { Module } from "@nestjs/common";
import { TasksModule } from "../tasks/tasks.module";
import { OffboardingController } from "./offboarding.controller";
import { OffboardingService } from "./offboarding.service";

@Module({
  imports: [TasksModule],
  controllers: [OffboardingController],
  providers: [OffboardingService],
  exports: [OffboardingService],
})
export class OffboardingModule {}
