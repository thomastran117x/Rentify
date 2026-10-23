import { createHash, randomBytes } from "node:crypto";
import {
  SELF_LOCK_TOKEN_TTL_SECONDS,
  type SelfLockTokenPayload,
} from "@/features/auth/self-lock/self-lock.model";

/** The cache operations the store needs. */
export interface SelfLockTokenCache {
  setJson(key: string, value: unknown, ttlInSeconds?: number): Promise<void>;
  getDeleteJson<T>(key: string): Promise<T | null>;
}

const KEY_PREFIX = "auth:self-lock";

export function hashSelfLockToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues and consumes the single-use tokens behind "This wasn't me? Lock your
 * account" links. Only the token's hash is stored, so a Redis dump yields no
 * working links. Consuming reads and deletes the key in one operation, so a
 * link used twice, or by two racing requests, locks at most once. The token is
 * not tied to a session: the real user may already have been signed out.
 */
export class SelfLockTokenStore {
  constructor(
    private readonly cache: SelfLockTokenCache,
    private readonly ttlSeconds: number = SELF_LOCK_TOKEN_TTL_SECONDS,
  ) {}

  async issue(payload: SelfLockTokenPayload): Promise<string> {
    const token = randomBytes(32).toString("base64url");

    await this.cache.setJson(this.key(token), payload, this.ttlSeconds);

    return token;
  }

  /** The token's payload, once; null for a missing, spent or expired one. */
  async consume(token: string): Promise<SelfLockTokenPayload | null> {
    if (!token) {
      return null;
    }

    const payload = await this.cache.getDeleteJson<SelfLockTokenPayload>(
      this.key(token),
    );

    if (
      !payload ||
      typeof payload.userId !== "string" ||
      typeof payload.sourceEventId !== "string"
    ) {
      return null;
    }

    return payload;
  }

  private key(token: string): string {
    return `${KEY_PREFIX}:${hashSelfLockToken(token)}`;
  }
}
