/**
 * Auth provider contract. Phase 1 ships a LocalAuthProvider (email + password).
 * Later, an EntraAuthProvider implements this interface — login is swapped at
 * the boundary, app code is untouched. (Phase 1 seam only — do not build Entra now.)
 */

export interface AuthPrincipal {
  userId: string;
  email: string;
  name: string;
  role: "ADMIN" | "AGENT";
}

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AuthProvider {
  readonly name: string;
  authenticate(credentials: AuthCredentials): Promise<AuthPrincipal | null>;
}
