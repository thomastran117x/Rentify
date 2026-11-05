import { z } from "zod";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { Uuid } from "@/configuration/validation/uuid";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";

/**
 * Normalisation matches `emailAvailabilityQuerySchema` and the `.trim()
 * .toLowerCase()` every write path in `UsersRepository` applies, so the address
 * checked for availability is byte-for-byte the address later written.
 */
export const requestEmailChangeRequestSchema = z.object({
  email: z
    .email("Enter a valid email address.")
    .max(255, "Email must be at most 255 characters.")
    .transform((value) => value.trim().toLowerCase()),
});

export const confirmEmailChangeRequestSchema = z.object({
  code: z
    .string("Enter the 6-digit code we emailed you.")
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code we emailed you."),
});

/** A week: long enough to notice, and matching how long the address is held. */
export const EMAIL_CHANGE_REVERT_TTL_SECONDS = 7 * 24 * 60 * 60;

export const EMAIL_CHANGE_REVERT_TOKEN_MAX_LENGTH = 256;

export const EMAIL_CHANGE_REVERT_REASON = "Email change reverted by user";

export const EMAIL_CHANGE_REVERT_LINK_EXPIRED_MESSAGE =
  "This link has expired or was already used.";

export const emailChangeRevertRequestSchema = z
  .object({
    token: z
      .string({ error: "Token is required." })
      .trim()
      .min(1, "Token is required.")
      .max(EMAIL_CHANGE_REVERT_TOKEN_MAX_LENGTH, "Token is invalid."),
  })
  .strict();

/** What a revert link stands for. */
export interface EmailChangeRevertRecord {
  id: string;
  userId: string;
  oldEmail: string;
  newEmail: string;
  /** The `email.changed` audit event whose email carried the link. */
  sourceEventId: string;
}

export interface EmailChangeRevertResult {
  reverted: true;
  /**
   * How the owner gets back in. A hold needs a password reset; an account a
   * hold would strand signs in as it normally does.
   */
  nextStep: "reset_password" | "sign_in";
}

export type RequestEmailChangeRequestBody = z.infer<
  typeof requestEmailChangeRequestSchema
>;
export type ConfirmEmailChangeRequestBody = z.infer<
  typeof confirmEmailChangeRequestSchema
>;

export interface RequestEmailChangeInput {
  userId: Uuid;
  newEmail: string;
  client: ClientRequestContext;
  deviceId?: string;
}

export interface ResendEmailChangeCodeInput {
  userId: Uuid;
  client: ClientRequestContext;
  deviceId?: string;
}

export interface ConfirmEmailChangeInput {
  userId: Uuid;
  code: string;
  client: ClientRequestContext;
  deviceId?: string;
  audit?: AuthAuditContext;
}

/**
 * `newEmail` is redacted on the way out. The request that set it already knew
 * the address in full, but this shape is also returned by the pending-state
 * read, which any session on the account can call — including one an attacker
 * holds. Echoing the target back in full would hand them the address to
 * intercept.
 */
export interface EmailChangeRequestResult {
  newEmail: string;
  expiresInSeconds: number;
  resendAvailableInSeconds: number;
}

export interface PendingEmailChangeResult {
  pending: boolean;
  newEmail?: string;
  expiresInSeconds?: number;
}
