import type { AppRole } from "@/features/auth/auth.model";
import type { JwtClaims } from "@/features/auth/token/token.service";
import type { Uuid } from "@/configuration/validation/uuid";

export interface PersonalAccessTokenPrincipal {
  sub: Uuid;
  email?: string;
  role?: AppRole;
  deviceId?: string;
  authMethod: "pat";
  scopes: string[];
  personalAccessTokenId: Uuid;
  personalAccessTokenName: string;
}

export interface JwtAuthPrincipal extends JwtClaims {
  authMethod: "jwt";
}

export type AuthPrincipal = JwtAuthPrincipal | PersonalAccessTokenPrincipal;
