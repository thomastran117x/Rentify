import { z } from "zod";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import {
  optionalTrimmedString,
  requiredSafeTrimmedString,
  type OAuthProvider,
} from "@/features/auth/auth.model";
import type { Uuid } from "@/configuration/validation/uuid";
import { dateOfBirthSchema } from "@/features/auth/date-of-birth";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";

export const oauthStartRequestSchema = z.object({
  intent: z.enum(["login", "signup", "link"], {
    error: "Intent must be login, signup, or link.",
  }),
  deviceId: optionalTrimmedString,
});

export type OAuthStartRequestBody = z.infer<typeof oauthStartRequestSchema>;

/**
 * The callback names the sign-in it finishes by `state`; the nonce and PKCE
 * verifier are the server's, so the client no longer sends either.
 */
export const oauthAuthenticateRequestSchema = z
  .object({
    state: requiredSafeTrimmedString("OAuth state is required."),
    code: optionalTrimmedString,
    idToken: optionalTrimmedString,
    rememberMe: z.boolean().optional(),
    deviceId: optionalTrimmedString,
    firstName: optionalTrimmedString,
    lastName: optionalTrimmedString,
    totpCode: z.string().optional(),
    dateOfBirth: dateOfBirthSchema.optional(),
  })
  .superRefine((input, context) => {
    // Which of the two the sign-in needs is the server's call, made when the
    // flow started; here it only has to be exactly one.
    if (input.code && input.idToken) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Send either an authorization code or an ID token, not both.",
        path: ["idToken"],
      });
    }

    if (!input.code && !input.idToken) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Authorization code is required.",
        path: ["code"],
      });
    }
  });

export type OAuthAuthenticateRequestBody = z.infer<
  typeof oauthAuthenticateRequestSchema
>;

export interface OAuthAuthenticateInput {
  client: ClientRequestContext;
  state: string;
  code?: string;
  idToken?: string;
  rememberMe?: boolean;
  deviceId?: string;
  firstName?: string;
  lastName?: string;
  totpCode?: string;
  dateOfBirth?: string;
  audit?: AuthAuditContext;
}

export const completeOAuthSignupRequestSchema = z.object({
  signupToken: requiredSafeTrimmedString("Signup token is required."),
  dateOfBirth: dateOfBirthSchema,
  deviceId: optionalTrimmedString,
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
});

export type CompleteOAuthSignupRequestBody = z.infer<
  typeof completeOAuthSignupRequestSchema
>;

export interface CompleteOAuthSignupInput {
  client: ClientRequestContext;
  signupToken: string;
  dateOfBirth: string;
  deviceId?: string;
  audit?: AuthAuditContext;
}

export interface OAuthSignupRequiredResult {
  signupRequired: true;
  signupToken: string;
  expiresInSeconds: number;
}

export interface LinkOAuthProviderInput extends OAuthAuthenticateInput {
  userId: Uuid;
  provider: OAuthProvider;
  sessionId?: string;
}

export interface UnlinkOAuthProviderInput {
  userId: Uuid;
  provider: OAuthProvider;
  sessionId?: string;
  audit?: AuthAuditContext;
}

export interface LinkedOAuthProvidersResult {
  hasPassword: boolean;
  providers: Array<{
    id: Uuid;
    provider: OAuthProvider;
    providerEmail?: string;
    emailVerified: boolean;
    displayName?: string;
    linkedAt: string;
  }>;
}
