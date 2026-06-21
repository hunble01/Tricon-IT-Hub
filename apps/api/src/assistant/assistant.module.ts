import { Module } from "@nestjs/common";
import { DevicesModule } from "../devices/devices.module";
import { OffboardingModule } from "../offboarding/offboarding.module";
import { StaffModule } from "../staff/staff.module";
import { TasksModule } from "../tasks/tasks.module";
import { AssistantController } from "./assistant.controller";
import { AssistantService } from "./assistant.service";
import { TranscriptionService } from "./transcription.service";

@Module({
  imports: [TasksModule, DevicesModule, StaffModule, OffboardingModule],
  controllers: [AssistantController],
  providers: [AssistantService, TranscriptionService],
})
export class AssistantModule {}
