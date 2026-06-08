import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";
import { ConnectionsService } from "./connections.service";

@Controller("connections")
export class ConnectionsController {
  constructor(private readonly svc: ConnectionsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post(":id/sync")
  sync(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser, @Body() _body: unknown) {
    return this.svc.sync(id, actor);
  }

  @Post(":id/connect")
  connect(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser, @Body() _body: unknown) {
    return this.svc.connect(id, actor);
  }
}
