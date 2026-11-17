import { z } from "zod";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import { optionalTrimmedString } from "@/features/auth/auth.model";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";
import {
  passkeyAssertionCredentialSchema,
  type PasskeyAssertionCredential,
} from "@/features/auth/mfa/passkey/passkey.model";

/**
 * Asking for options names no one: the passkey chosen names the account. A
 * body that tries to (a username, say) is refused, not quietly ignored.
 */
export const passkeyLoginOptionsRequestSchema = z.object({}).strict();

export const passkeyLoginVerifyRequestSchema = z.object({
  credential: passkeyAssertionCredentialSchema,
  rememberMe: z.boolean().optional(),
  deviceId: optionalTrimmedString,
});

export type PasskeyLoginVerifyRequestBody = z.infer<
  typeof passkeyLoginVerifyRequestSchema
>;

export interface PasskeyLoginInput {
  credential: PasskeyAssertionCredential;
  rememberMe?: boolean;
  deviceId?: string;
  client: ClientRequestContext;
  audit: AuthAuditContext;
}
