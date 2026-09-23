import { randomBytes } from "node:crypto";
import type { CacheService } from "@/features/cache/cache.service";
import type { VerifiedOAuthProfile } from "@/features/auth/oauth/oauth.types";

const OAUTH_SIGNUP_CACHE_PREFIX = "auth:oauth-signup";
const OAUTH_SIGNUP_TTL_IN_SECONDS = 10 * 60;
const OAUTH_SIGNUP_LOCK_TTL_IN_MS = 10_000;

export interface PendingOAuthSignupRecord {
  profile: VerifiedOAuthProfile;
  rememberMe?: boolean;
  deviceId?: string;
  createdAt: string;
}

export class OAuthSignupStore {
  constructor(private readonly cacheService: CacheService) {}

  getTtlInSeconds(): number {
    return OAUTH_SIGNUP_TTL_IN_SECONDS;
  }

  async create(record: PendingOAuthSignupRecord): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.cacheService.setJson(
      this.getKey(token),
      record,
      OAUTH_SIGNUP_TTL_IN_SECONDS,
    );
    return token;
  }

  read(token: string): Promise<PendingOAuthSignupRecord | null> {
    return this.cacheService.getJson<PendingOAuthSignupRecord>(
      this.getKey(token),
    );
  }

  delete(token: string): Promise<boolean> {
    return this.cacheService.delete(this.getKey(token));
  }

  acquireCompletionLock(token: string) {
    return this.cacheService.acquireLock(
      `${OAUTH_SIGNUP_CACHE_PREFIX}:complete:${token}`,
      OAUTH_SIGNUP_LOCK_TTL_IN_MS,
    );
  }

  private getKey(token: string): string {
    return `${OAUTH_SIGNUP_CACHE_PREFIX}:${token}`;
  }
}
