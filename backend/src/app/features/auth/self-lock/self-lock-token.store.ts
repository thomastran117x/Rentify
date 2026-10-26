import { createHash, randomBytes } from "node:crypto";
import {
  SELF_LOCK_TOKEN_TTL_SECONDS,
  type SelfLockTokenPayload,
} from "@/features/auth/self-lock/self-lock.model";

/** The cache operations the store needs. */
export interface SelfLockTokenCache {
  setJson(key: string, value: unknown, ttlInSeconds?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  eval<TResult>(
    script: string,
    keys?: string[],
    args?: string[],
  ): Promise<TResult>;
}

const KEY_PREFIX = "auth:self-lock";
const CLAIMED_KEY_PREFIX = "auth:self-lock:claimed";

/**
 * Moves an unused token to its claimed key and returns its payload, in one
 * step. RENAME keeps the key's expiry, so a claimed token still lapses when
 * the link would have.
 */
export const SELF_LOCK_CLAIM_SCRIPT = `
local value = redis.call("GET", KEYS[1])
if not value then
  return false
end
redis.call("RENAME", KEYS[1], KEYS[2])
return value
`;

/** Puts a claimed token back, unless it has expired meanwhile. */
export const SELF_LOCK_RELEASE_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  return redis.call("RENAMENX", KEYS[1], KEYS[2])
end
return 0
`;

export function hashSelfLockToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues and redeems the single-use tokens behind "This wasn't me? Lock your
 * account" links. Only the token's hash is stored, so a Redis dump yields no
 * working links. The token is not tied to a session: the real user may
 * already have been signed out.
 *
 * Redeeming is two steps. `claim` takes the token atomically, so a link used
 * twice, or by two racing requests, is acted on at most once. The caller then
 * either `complete`s it, spending it for good, or `release`s it after an
 * unexpected failure, so a database outage does not burn the user's only link.
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

  /** The token's payload, taken once; null for a missing, spent or expired one. */
  async claim(token: string): Promise<SelfLockTokenPayload | null> {
    if (!token) {
      return null;
    }

    const value = await this.cache.eval<string | null>(SELF_LOCK_CLAIM_SCRIPT, [
      this.key(token),
      this.claimedKey(token),
    ]);
    const payload = parsePayload(value);

    if (!payload) {
      if (value) {
        await this.complete(token);
      }

      return null;
    }

    return payload;
  }

  /** Spends a claimed token for good. */
  async complete(token: string): Promise<void> {
    await this.cache.delete(this.claimedKey(token));
  }

  /** Makes a claimed token usable again, keeping its original expiry. */
  async release(token: string): Promise<void> {
    await this.cache.eval<number>(SELF_LOCK_RELEASE_SCRIPT, [
      this.claimedKey(token),
      this.key(token),
    ]);
  }

  private key(token: string): string {
    return `${KEY_PREFIX}:${hashSelfLockToken(token)}`;
  }

  private claimedKey(token: string): string {
    return `${CLAIMED_KEY_PREFIX}:${hashSelfLockToken(token)}`;
  }
}

function parsePayload(value: string | null): SelfLockTokenPayload | null {
  if (!value) {
    return null;
  }

  try {
    const payload = JSON.parse(value) as Partial<SelfLockTokenPayload> | null;

    if (
      !payload ||
      typeof payload.userId !== "string" ||
      typeof payload.sourceEventId !== "string"
    ) {
      return null;
    }

    return payload as SelfLockTokenPayload;
  } catch {
    return null;
  }
}
