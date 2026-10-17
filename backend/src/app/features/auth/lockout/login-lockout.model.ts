import { z } from "zod";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import { requiredSafeTrimmedString } from "@/features/auth/auth.model";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";

export const unlockLocalLoginRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Unlock code must be 6 digits."),
});

export type UnlockLocalLoginRequestBody = z.infer<
  typeof unlockLocalLoginRequestSchema
>;

export const resendUnlockLocalLoginRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
});

export type ResendUnlockLocalLoginRequestBody = z.infer<
  typeof resendUnlockLocalLoginRequestSchema
>;

export interface UnlockLocalLoginInput {
  email: string;
  code: string;
  audit: AuthAuditContext;
}

export interface ResendUnlockLocalLoginInput {
  client: ClientRequestContext;
  email: string;
  deviceId?: string;
  audit: AuthAuditContext;
}

export interface LocalLoginAttemptRecord {
  failedAttempts: number;
  lockedAt?: string;
}
