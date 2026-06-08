import { Module } from "@nestjs/common";
import { StaffModule } from "../staff/staff.module";
import { ConnectionsController } from "./connections.controller";
import { ConnectionsService } from "./connections.service";
import { OutlookAdapter } from "./outlook.adapter";
import { ServiceNowAdapter } from "./servicenow.adapter";

@Module({
  imports: [StaffModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService, ServiceNowAdapter, OutlookAdapter],
  // Exported so the tickets module can push replies through the same adapters.
  exports: [ServiceNowAdapter, OutlookAdapter],
})
export class ConnectionsModule {}
