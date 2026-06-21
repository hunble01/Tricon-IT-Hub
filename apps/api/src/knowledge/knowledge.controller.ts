import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";
import { CreateArticleDto, GenerateArticleDto } from "./dto";
import { KnowledgeService } from "./knowledge.service";

@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly svc: KnowledgeService) {}

  @Get()
  list(@Query("q") q?: string) {
    return this.svc.list(q);
  }

  /** Draft a KB article from a resolved ticket (review before saving). */
  @Post("generate")
  generate(@Body() dto: GenerateArticleDto) {
    return this.svc.generateFromTicket(dto);
  }

  @Post()
  create(@Body() dto: CreateArticleDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.create(dto, actor);
  }
}
