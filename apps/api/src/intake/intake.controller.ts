import { Body, Controller, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";
import { AnalyzeIntakeDto, CommitIntakeDto } from "./dto";
import { IntakeService } from "./intake.service";

@Controller("intake")
export class IntakeController {
  constructor(private readonly svc: IntakeService) {}

  @Post("analyze")
  analyze(@Body() dto: AnalyzeIntakeDto) {
    return this.svc.analyze(dto);
  }

  @Post("commit")
  commit(@Body() dto: CommitIntakeDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.commit(dto, actor);
  }
}
