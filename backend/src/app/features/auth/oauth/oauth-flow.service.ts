import { createHash, randomBytes } from "node:crypto";
import { environment } from "@/configuration/environment";
import BadRequestError from "@/errors/http/bad-request.error";
import OAuthStateInvalidError from "@/errors/http/oauth-state-invalid.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type {
  OAuthFlowIntent,
  OAuthFlowStore,
  OAuthTokenDelivery,
} from "@/features/auth/oauth/oauth-flow.store";
import type { OAuthProvider } from "@/features/auth/oauth/oauth.types";

const RANDOM_VALUE_BYTES = 32;

export interface StartOAuthFlowInput {
  provider: OAuthProvider;
  intent: OAuthFlowIntent;
  deviceId?: string;
  /** Required for `link`: the signed-in account the provider will join. */
  userId?: string;
}

export interface OAuthFlowStartResult {
  state: string;
  nonce: string;
  /** S256 PKCE challenge; present only when the backend redeems the code. */
  codeChallenge?: string;
  tokenDelivery: OAuthTokenDelivery;
  expiresInSeconds: number;
}

export interface RedeemOAuthFlowInput {
  provider: OAuthProvider;
  /** The intents this endpoint finishes. */
  allowedIntents: readonly OAuthFlowIntent[];
  state: string;
  deviceId?: string;
  /** The caller, on the link endpoint. */
  userId?: string;
  code?: string;
  idToken?: string;
}

/** What a provider service needs to verify the sign-in, all server-sourced. */
export interface RedeemedOAuthFlow {
  nonce: string;
  code?: string;
  codeVerifier?: string;
  idToken?: string;
}

function createRandomValue(): string {
  return randomBytes(RANDOM_VALUE_BYTES).toString("base64url");
}

function createCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

/**
 * Issues the `state`, `nonce` and PKCE verifier for every OAuth sign-in, and
 * checks the callback against them.
 *
 * Without this, the client chose its own nonce, so checking the ID token's
 * nonce only proved the token matched a value the caller picked. A token
 * obtained anywhere else could be replayed with its own nonce. Now the nonce
 * is one the server issued, for this provider, purpose, device and (when
 * linking) account, and it can be spent once.
 */
export class OAuthFlowService {
  constructor(private readonly store: OAuthFlowStore) {}

  async start(input: StartOAuthFlowInput): Promise<OAuthFlowStartResult> {
    if (!input.deviceId) {
      throw new BadRequestError("A device id is required to start sign-in.");
    }

    if (input.intent === "link" && !input.userId) {
      throw new UnauthorizedError("Sign in before linking a provider.");
    }

    const tokenDelivery = this.resolveTokenDelivery(input.provider);
    // Apple's code exchange is authenticated by a signed client secret and
    // takes no PKCE verifier; Google and Microsoft both use one.
    const codeVerifier =
      tokenDelivery === "code" && input.provider !== "apple"
        ? createRandomValue()
        : undefined;
    const state = createRandomValue();
    const nonce = createRandomValue();

    await this.store.save(state, {
      provider: input.provider,
      intent: input.intent,
      nonce,
      codeVerifier,
      tokenDelivery,
      deviceId: input.deviceId,
      userId: input.intent === "link" ? input.userId : undefined,
      createdAt: new Date().toISOString(),
    });

    return {
      state,
      nonce,
      ...(codeVerifier
        ? { codeChallenge: createCodeChallenge(codeVerifier) }
        : {}),
      tokenDelivery,
      expiresInSeconds: this.store.getTtlInSeconds(),
    };
  }

  /**
   * Spends the callback's state and returns the server's half of the sign-in.
   * The state is gone even when a check fails, so a rejected attempt cannot be
   * retried with corrected inputs; the client starts again.
   */
  async redeem(input: RedeemOAuthFlowInput): Promise<RedeemedOAuthFlow> {
    const record = await this.store.consume(input.state);

    if (
      !record ||
      record.provider !== input.provider ||
      !input.allowedIntents.includes(record.intent) ||
      record.deviceId !== input.deviceId ||
      (record.intent === "link" && record.userId !== input.userId)
    ) {
      throw new OAuthStateInvalidError();
    }

    if (record.tokenDelivery === "code") {
      if (input.idToken || !input.code) {
        throw new BadRequestError(
          "This sign-in must finish with an authorization code.",
        );
      }

      return {
        nonce: record.nonce,
        code: input.code,
        codeVerifier: record.codeVerifier,
      };
    }

    if (input.code || !input.idToken) {
      throw new BadRequestError("This sign-in must finish with an ID token.");
    }

    return { nonce: record.nonce, idToken: input.idToken };
  }

  private resolveTokenDelivery(provider: OAuthProvider): OAuthTokenDelivery {
    return environment.getOAuthClientIdTokenProviders().includes(provider)
      ? "id_token"
      : "code";
  }
}
