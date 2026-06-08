import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import type { AuthProvider } from "@tricon/shared";
import bcrypt from "bcryptjs";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { AUTH_PROVIDER } from "./tokens";
import { AuthenticatedUser, JwtPayload } from "./types";

export interface AuthSession {
  token: string;
  user: AuthenticatedUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(AUTH_PROVIDER) private readonly authProvider: AuthProvider,
  ) {}

  async register(dto: RegisterDto, actor?: AuthenticatedUser): Promise<AuthSession> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException("User with that email already exists");

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash,
        role: (dto.role as UserRole | undefined) ?? UserRole.AGENT,
      },
    });

    await this.audit.record({
      action: "user.register",
      userId: actor?.userId ?? user.id,
      entityType: "User",
      entityId: user.id,
      metadata: { email: user.email, role: user.role },
    });

    return this.issueSession(user);
  }

  async login(dto: LoginDto): Promise<AuthSession> {
    const principal = await this.authProvider.authenticate({
      email: dto.email,
      password: dto.password,
    });
    if (!principal) throw new UnauthorizedException("Invalid credentials");

    await this.audit.record({
      action: "user.login",
      userId: principal.userId,
      entityType: "User",
      entityId: principal.userId,
      metadata: { provider: this.authProvider.name },
    });

    return this.issueSession({
      id: principal.userId,
      email: principal.email,
      name: principal.name,
      role: principal.role,
    });
  }

  private issueSession(user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
  }): AuthSession {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    const token = this.jwt.sign(payload);
    return {
      token,
      user: { userId: user.id, email: user.email, name: user.name, role: user.role },
    };
  }
}
