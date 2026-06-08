import { ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { AuthenticatedUser } from "./types";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly authDisabled: boolean;
  private devUser: AuthenticatedUser | null = null;
  private devUserLoad: Promise<AuthenticatedUser | null> | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super();
    // Dev escape hatch: skip JWT enforcement and run every request as the
    // seeded admin. Off by default — only active when AUTH_DISABLED=true.
    // All auth plumbing stays intact, so re-enabling is a one-flag flip.
    this.authDisabled = this.config.get<string>("AUTH_DISABLED") === "true";
    if (this.authDisabled) {
      this.logger.warn(
        "AUTH_DISABLED=true — JWT enforcement is OFF; all requests run as the dev admin. Never enable in production.",
      );
    }
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (this.authDisabled) {
      const user = await this.resolveDevUser();
      const req = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
      if (user) req.user = user;
      return true;
    }

    return (await super.canActivate(context)) as boolean;
  }

  /** Resolve (and cache) a real User row to attach so FK-bearing writes work. */
  private resolveDevUser(): Promise<AuthenticatedUser | null> {
    if (this.devUser) return Promise.resolve(this.devUser);
    if (!this.devUserLoad) {
      const email = this.config.get<string>("SEED_ADMIN_EMAIL");
      this.devUserLoad = this.prisma.user
        .findFirst({
          where: email ? { email } : { role: UserRole.ADMIN },
          orderBy: { createdAt: "asc" },
        })
        .then((u) => u ?? this.prisma.user.findFirst({ orderBy: { createdAt: "asc" } }))
        .then((u) => {
          if (!u) {
            this.logger.error("AUTH_DISABLED but no User exists to impersonate.");
            return null;
          }
          this.devUser = { userId: u.id, email: u.email, name: u.name, role: u.role };
          return this.devUser;
        });
    }
    return this.devUserLoad;
  }
}
