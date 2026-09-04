import { z } from "zod";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import { optionalTrimmedString } from "@/features/auth/auth.model";
import type { Uuid } from "@/configuration/validation/uuid";

export const refreshRequestSchema = z.object({
  refreshToken: optionalTrimmedString,
});

export type RefreshRequestBody = z.infer<typeof refreshRequestSchema>;

export interface RefreshInput {
  client: ClientRequestContext;
  refreshToken?: string;
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
