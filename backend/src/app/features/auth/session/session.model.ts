import { z } from "zod";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import { optionalTrimmedString } from "@/features/auth/auth.model";
import type { Uuid } from "@/configuration/validation/uuid";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";

export const refreshRequestSchema = z.object({
  refreshToken: optionalTrimmedString,
});

export const revokeSessionsRequestSchema = z.object({
  scope: z.enum(["others", "all"]),
});

export type RefreshRequestBody = z.infer<typeof refreshRequestSchema>;

export interface RefreshInput {
  client: ClientRequestContext;
  refreshToken?: string;
  audit?: AuthAuditContext;
}

export interface LocalVerifyResult {
  verified: true;
  auth: {
    userId: Uuid;
    deviceId?: string;
    role?: string;
  };
  client: ClientRequestContext;
}

export interface LogoutResult {
  loggedOut: true;
  auth: {
    userId: Uuid;
    deviceId?: string;
  };
  client: ClientRequestContext;
}

export interface SessionSummary {
  id: string;
  deviceLabel: string;
  platform: string | null;
  browser: string | null;
  os: string | null;
  firstIpAddress: string | null;
  lastIpAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  rememberMe: boolean;
  current: boolean;
}

export interface SessionListResult {
  sessions: SessionSummary[];
}

export interface RevokeSessionResult {
  revoked: true;
  id: string;
  current: boolean;
}

export type RevokeSessionsScope = z.infer<
  typeof revokeSessionsRequestSchema
>["scope"];

export interface RevokeSessionsResult {
  scope: RevokeSessionsScope;
  revokedSessionCount: number;
  revokedPersonalAccessTokenCount: number;
}
