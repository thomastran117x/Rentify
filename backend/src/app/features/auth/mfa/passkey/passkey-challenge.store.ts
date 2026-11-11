import { createHash } from "node:crypto";
import type { Uuid } from "@/configuration/validation/uuid";
import type { CacheService } from "@/features/cache/cache.service";
import { PASSKEY_CHALLENGE_TTL_SECONDS } from "./passkey.model";

const PASSKEY_CHALLENGE_CACHE_PREFIX = "auth:webauthn";

/**
 * What a challenge was issued for. Each purpose has its own key space, so a
 * challenge issued to register a passkey can never answer a sign-in.
 */
export type PasskeyChallengePurpose = "register" | "step-up" | "login";

export interface PasskeyChallengeRecord {
  challenge: string;
  userId: Uuid;
  createdAt: string;
}

/**
 * The challenges a WebAuthn ceremony is answered against. One per purpose and
 * binding: issuing another replaces it, so only the latest prompt can finish.
 *
 * A challenge is single-use because it is read with GETDEL. Of two requests
 * racing with the same response, one gets the record and the other nothing,
 * and an expired challenge is simply gone. The binding is hashed so a session
 * id or a sign-in token never appears in a key.
 */
export class PasskeyChallengeStore {
  constructor(private readonly cacheService: CacheService) {}

  async issue(
    purpose: PasskeyChallengePurpose,
    binding: string,
    input: { challenge: string; userId: Uuid },
    ttlSeconds: number = PASSKEY_CHALLENGE_TTL_SECONDS,
  ): Promise<void> {
    const record: PasskeyChallengeRecord = {
      challenge: input.challenge,
      userId: input.userId,
      createdAt: new Date().toISOString(),
    };

    await this.cacheService.setJson(
      this.getKey(purpose, binding),
      record,
      Math.max(1, Math.floor(ttlSeconds)),
    );
  }

  consume(
    purpose: PasskeyChallengePurpose,
    binding: string,
  ): Promise<PasskeyChallengeRecord | null> {
    return this.cacheService.getDeleteJson<PasskeyChallengeRecord>(
      this.getKey(purpose, binding),
    );
  }

  private getKey(purpose: PasskeyChallengePurpose, binding: string): string {
    const hash = createHash("sha256").update(binding).digest("hex");

    return `${PASSKEY_CHALLENGE_CACHE_PREFIX}:${purpose}:${hash}`;
  }
}
