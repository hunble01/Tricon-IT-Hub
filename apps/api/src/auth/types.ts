import { UserRole } from "@prisma/client";

/** Shape attached to req.user after JWT validation. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
}

/** JWT payload encoded by AuthService and decoded by JwtStrategy. */
export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
}
