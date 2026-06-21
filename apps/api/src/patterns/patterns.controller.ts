import { Controller, Get } from "@nestjs/common";
import { PatternsService } from "./patterns.service";

@Controller("patterns")
export class PatternsController {
  constructor(private readonly svc: PatternsService) {}

  @Get()
  detect() {
    return this.svc.detect();
  }
}
