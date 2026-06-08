import { Controller, Get } from "@nestjs/common";
import { SlaService } from "./sla.service";

@Controller("sla")
export class SlaController {
  constructor(private readonly svc: SlaService) {}

  /** Current SLA standing — breached + at-risk open tickets. */
  @Get()
  scan() {
    return this.svc.scan();
  }
}
