import { Module } from "@nestjs/common";
import { SlaController } from "./sla.controller";
import { SlaScheduler } from "./sla.scheduler";
import { SlaService } from "./sla.service";

@Module({
  controllers: [SlaController],
  providers: [SlaService, SlaScheduler],
  exports: [SlaService],
})
export class SlaModule {}
