import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get("summary")
  summary() {
    return this.svc.summary();
  }

  @Get("activity")
  activity(@Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number) {
    return this.svc.recentActivity(Math.min(Math.max(limit, 1), 100));
  }
}
