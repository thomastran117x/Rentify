import { createHash } from "node:crypto";
import type { OAuthProvider } from "@/features/auth/oauth/oauth.types";

const OAUTH_FLOW_CACHE_PREFIX = "auth:oauth-flow";
const OAUTH_FLOW_TTL_IN_SECONDS = 10 * 60;

/** What the sign-in attempt is for; a callback may only finish its own kind. */
export type OAuthFlowIntent = "login" | "signup" | "link";

/**
 * How the callback proves the sign-in: `code` for a code the backend redeems,
 * `id_token` for a token the browser already holds.
 */
export type OAuthTokenDelivery = "code" | "id_token";

export interface OAuthFlowRecord {
  provider: OAuthProvider;
  intent: OAuthFlowIntent;
  nonce: string;
  /** Only for a PKCE code flow; it never leaves the server. */
  codeVerifier?: string;
  tokenDelivery: OAuthTokenDelivery;
  deviceId: string;
  /** The account a link attempt was started by. */
  userId?: string;
  createdAt: string;
}

/** The cache operations the flow store needs. */
export interface OAuthFlowCache {
  setJson(key: string, value: unknown, ttlInSeconds?: number): Promise<void>;
  getDeleteJson<T>(key: string): Promise<T | null>;
}

/**
 * The server's record of each OAuth sign-in it started, keyed by its `state`.
 *
 * Only a hash of `state` is part of the key, so a Redis dump does not hand
 * out live states. A record is consumed by reading and deleting it in one
 * operation: two callbacks racing with the same state cannot both see it,
 * and a state seen once cannot be replayed.
 */
export class OAuthFlowStore {
  constructor(private readonly cache: OAuthFlowCache) {}

  getTtlInSeconds(): number {
    return OAUTH_FLOW_TTL_IN_SECONDS;
  }

  async save(state: string, record: OAuthFlowRecord): Promise<void> {
    await this.cache.setJson(
      this.getKey(state),
      record,
      OAUTH_FLOW_TTL_IN_SECONDS,
    );
  }

  /** The flow's record, once; null for a missing, spent, or expired state. */
  async consume(state: string): Promise<OAuthFlowRecord | null> {
    if (!state) {
      return null;
    }

    return this.cache.getDeleteJson<OAuthFlowRecord>(this.getKey(state));
  }

  private getKey(state: string): string {
    const digest = createHash("sha256").update(state).digest("base64url");
    return `${OAUTH_FLOW_CACHE_PREFIX}:${digest}`;
  }
}
