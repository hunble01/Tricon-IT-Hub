import { Controller, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { MemoryService } from "./memory.service";

@Controller("memory")
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  /**
   * Re-embed every memory entry with the current provider. Admin-only
   * maintenance op — run once after changing EMBEDDING_PROVIDER so old vectors
   * don't poison recall.
   */
  @Post("reindex")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  reindex() {
    return this.memory.reembedAll();
  }
}
