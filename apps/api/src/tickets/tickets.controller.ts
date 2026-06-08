import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { TicketPriority, TicketSource, TicketStatus } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";
import { AssignTicketDto, DraftTicketDto, ResolveTicketDto, SendReplyDto } from "./dto";
import { TicketsService } from "./tickets.service";

@Controller("tickets")
export class TicketsController {
  constructor(private readonly svc: TicketsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get("queue")
  queue(
    @CurrentUser() actor: AuthenticatedUser,
    @Query("mine") mine?: string,
    @Query("status") status?: TicketStatus,
    @Query("priority") priority?: TicketPriority,
    @Query("source") source?: TicketSource,
  ) {
    return this.svc.queue(actor, {
      mine: mine === "true" || mine === "1",
      status,
      priority,
      source,
    });
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.get(id, actor.userId);
  }

  @Post("draft")
  draft(@Body() dto: DraftTicketDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.draft(dto, actor);
  }

  @Post(":id/redraft")
  redraft(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.redraft(id, actor);
  }

  @Post(":id/resolve")
  resolve(
    @Param("id") id: string,
    @Body() dto: ResolveTicketDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.resolve(id, dto, actor);
  }

  @Post(":id/assign")
  assign(
    @Param("id") id: string,
    @Body() dto: AssignTicketDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.assign(id, dto, actor);
  }

  @Post(":id/unassign")
  unassign(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.unassign(id, actor);
  }

  @Post(":id/send")
  send(
    @Param("id") id: string,
    @Body() dto: SendReplyDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.send(id, dto, actor);
  }

  @Post("reindex-kb")
  reindexKnowledge(@CurrentUser() actor: AuthenticatedUser) {
    return this.svc.reindexKnowledge(actor);
  }
}
