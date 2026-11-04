export type OAuthProvider = "google" | "microsoft" | "apple";

/**
 * What a provider service verifies. The nonce and code verifier come from the
 * server's record of the sign-in, never from the request.
 */
export interface OAuthAuthenticateInput {
  code?: string;
  codeVerifier?: string;
  idToken?: string;
  nonce: string;
  firstName?: string;
  lastName?: string;
}

export interface VerifiedOAuthProfile {
  provider: OAuthProvider;
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
}
