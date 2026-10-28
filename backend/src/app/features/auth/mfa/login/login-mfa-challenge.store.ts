import { createHash, randomBytes } from "node:crypto";
import type { CacheService } from "@/features/cache/cache.service";
import {
  LOGIN_MFA_FACTORS,
  type LoginMfaChallengeRecord,
  type LoginMfaRequiredResult,
  type NewLoginMfaChallenge,
} from "@/features/auth/mfa/login/login-mfa.model";

const LOGIN_MFA_CACHE_PREFIX = "auth:login-mfa";
export const LOGIN_MFA_CHALLENGE_TTL_IN_SECONDS = 5 * 60;
const LOGIN_MFA_COMPLETION_LOCK_TTL_IN_MS = 10_000;

/**
 * The pending second step of a sign-in. Only a hash of the token is stored,
 * so a read of the cache cannot be replayed as a challenge.
 *
 * A challenge is single-use: it is deleted once it completes a sign-in, and
 * every use goes through the completion lock so two requests cannot both
 * complete it.
 */
export class LoginMfaChallengeStore {
  constructor(private readonly cacheService: CacheService) {}

  getTtlInSeconds(): number {
    return LOGIN_MFA_CHALLENGE_TTL_IN_SECONDS;
  }

  async issue(
    challenge: NewLoginMfaChallenge,
  ): Promise<LoginMfaRequiredResult> {
    const token = randomBytes(32).toString("base64url");
    const record: LoginMfaChallengeRecord = {
      ...challenge,
      failedAttempts: 0,
      createdAt: new Date().toISOString(),
    };

    await this.cacheService.setJson(
      this.getKey(token),
      record,
      LOGIN_MFA_CHALLENGE_TTL_IN_SECONDS,
    );

    return {
      mfaRequired: true,
      mfaChallengeToken: token,
      availableFactors: [...LOGIN_MFA_FACTORS],
      expiresInSeconds: LOGIN_MFA_CHALLENGE_TTL_IN_SECONDS,
    };
  }

  read(token: string): Promise<LoginMfaChallengeRecord | null> {
    return this.cacheService.getJson<LoginMfaChallengeRecord>(
      this.getKey(token),
    );
  }

  /** Writes back a changed record without extending how long it lives. */
  async update(token: string, record: LoginMfaChallengeRecord): Promise<void> {
    const key = this.getKey(token);
    const remainingSeconds = await this.cacheService.ttl(key);

    if (remainingSeconds <= 0) {
      return;
    }

    await this.cacheService.setJson(key, record, remainingSeconds);
  }

  async delete(token: string): Promise<void> {
    await this.cacheService.delete(this.getKey(token));
  }

  acquireCompletionLock(token: string) {
    return this.cacheService.acquireLock(
      `${LOGIN_MFA_CACHE_PREFIX}:complete:${hashToken(token)}`,
      LOGIN_MFA_COMPLETION_LOCK_TTL_IN_MS,
    );
  }

  private getKey(token: string): string {
    return `${LOGIN_MFA_CACHE_PREFIX}:${hashToken(token)}`;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
