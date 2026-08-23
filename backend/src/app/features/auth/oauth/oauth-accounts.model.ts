import { z } from "zod";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import {
  optionalTrimmedString,
  requiredSafeTrimmedString,
  type OAuthProvider,
} from "@/features/auth/auth.model";

export const oauthAuthenticateRequestSchema = z
  .object({
    code: optionalTrimmedString,
    codeVerifier: optionalTrimmedString,
    idToken: optionalTrimmedString,
    nonce: requiredSafeTrimmedString("Nonce is required."),
    rememberMe: z.boolean().optional(),
    deviceId: optionalTrimmedString,
    firstName: optionalTrimmedString,
    lastName: optionalTrimmedString,
    totpCode: z.string().optional(),
  })
  .superRefine((input, context) => {
    // An id token is self-contained. Without one, the authorization-code flow
    // needs both halves of the PKCE exchange.
    if (input.idToken) {
      return;
    }

    if (!input.code) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Authorization code is required.",
        path: ["code"],
      });
    }

    if (!input.codeVerifier) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Code verifier is required.",
        path: ["codeVerifier"],
      });
    }
  });

export type OAuthAuthenticateRequestBody = z.infer<
  typeof oauthAuthenticateRequestSchema
>;

export interface OAuthAuthenticateInput {
  client: ClientRequestContext;
  code?: string;
  codeVerifier?: string;
  idToken?: string;
  nonce: string;
  rememberMe?: boolean;
  deviceId?: string;
  firstName?: string;
  lastName?: string;
  totpCode?: string;
}

export interface LinkOAuthProviderInput extends OAuthAuthenticateInput {
  userId: string;
  provider: OAuthProvider;
}

export interface UnlinkOAuthProviderInput {
  userId: string;
  provider: OAuthProvider;
}

export interface LinkedOAuthProvidersResult {
  hasPassword: boolean;
  providers: Array<{
    id: string;
    provider: OAuthProvider;
    providerEmail?: string;
    emailVerified: boolean;
    displayName?: string;
    linkedAt: string;
  }>;
}
