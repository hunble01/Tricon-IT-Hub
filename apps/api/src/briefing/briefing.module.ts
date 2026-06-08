import { Module } from "@nestjs/common";
import { AlertsModule } from "../alerts/alerts.module";
import { SlaModule } from "../sla/sla.module";
import { BriefingController } from "./briefing.controller";
import { BriefingService } from "./briefing.service";

@Module({
  imports: [AlertsModule, SlaModule],
  controllers: [BriefingController],
  providers: [BriefingService],
})
export class BriefingModule {}
