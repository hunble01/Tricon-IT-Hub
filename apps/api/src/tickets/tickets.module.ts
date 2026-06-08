import { Module } from "@nestjs/common";
import { ConnectionsModule } from "../connections/connections.module";
import { MemoryModule } from "../memory/memory.module";
import { StaffModule } from "../staff/staff.module";
import { ManualAdapter } from "./manual.adapter";
import { TicketsController } from "./tickets.controller";
import { TicketsService } from "./tickets.service";

@Module({
  imports: [MemoryModule, StaffModule, ConnectionsModule],
  controllers: [TicketsController],
  providers: [TicketsService, ManualAdapter],
  exports: [TicketsService],
})
export class TicketsModule {}
