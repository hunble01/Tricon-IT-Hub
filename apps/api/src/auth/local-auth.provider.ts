import { Injectable } from "@nestjs/common";
import type { AuthCredentials, AuthPrincipal, AuthProvider } from "@tricon/shared";
import bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Phase 1 auth provider — email + password against our own User table.
 *
 * Implements AuthProvider so that swapping in EntraAuthProvider (Phase 4
 * M365/Entra SSO) is a wiring change in AuthModule, nothing else.
 */
@Injectable()
export class LocalAuthProvider implements AuthProvider {
  readonly name = "local";

  constructor(private readonly prisma: PrismaService) {}

  async authenticate(credentials: AuthCredentials): Promise<AuthPrincipal | null> {
    const user = await this.prisma.user.findUnique({ where: { email: credentials.email } });
    if (!user) return null;
    const ok = await bcrypt.compare(credentials.password, user.passwordHash);
    if (!ok) return null;
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }
}
