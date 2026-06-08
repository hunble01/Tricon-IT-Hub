import { Controller, Get } from "@nestjs/common";
import { BriefingService } from "./briefing.service";

@Controller("briefing")
export class BriefingController {
  constructor(private readonly svc: BriefingService) {}

  /** The daily briefing — one read-model of what needs attention today. */
  @Get()
  build() {
    return this.svc.build();
  }
}
