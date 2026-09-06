import type { CacheService } from "@/features/cache/cache.service";
import type { IdentityBloomService } from "@/features/auth/identity-bloom/identity-bloom.service";
import { getPendingSignupKey } from "@/features/auth/pending-signup-keys";
import { getPendingSignupUsernameKey } from "@/features/auth/pending-signup-username";

const PENDING_LOCAL_SIGNUP_VERIFY_LOCK_PREFIX = "auth:pending-signup-verify";
const PENDING_LOCAL_SIGNUP_VERIFY_LOCK_TTL_IN_MS = 10_000;

export interface PendingLocalSignupRecord {
  username: string;
  email: string;
  passwordHash: string;
  firstName?: string;
  lastName?: string;
  deviceId?: string;
  createdAt: string;
}

/**
 * Signups live in the cache, not the database, until the emailed code is
 * confirmed — an unverified address must not be able to occupy a row.
 *
 * Two keys are kept per signup: one by email holding the record, and one by
 * username holding the email, so a name can be recognised as soft-reserved
 * without scanning. Both expire with the OTP.
 */
export class PendingSignupStore {
  constructor(
    private readonly cacheService: CacheService,
    private readonly usernameBloomService: IdentityBloomService,
    private readonly emailBloomService: IdentityBloomService,
  ) {}

  async write(
    signup: PendingLocalSignupRecord,
    ttlInSeconds: number,
  ): Promise<void> {
    const existingSignup = await this.read(signup.email);

    if (existingSignup && existingSignup.username !== signup.username) {
      await this.cacheService.delete(
        this.getUsernameKey(existingSignup.username),
      );
    }

    await this.cacheService.setJson(
      this.getKey(signup.email),
      signup,
      ttlInSeconds,
    );
    await this.cacheService.setJson(
      this.getUsernameKey(signup.username),
      signup.email,
      ttlInSeconds,
    );

    // A reservation makes the name unavailable just as surely as a row does, and
    // a bloom miss skips the reservation lookup too. Leaving it out would let
    // the endpoint report a reserved name as free.
    await this.usernameBloomService.add(signup.username);
    // The email side of the same argument. A pending address does not *block* a
    // second signup, but it does change the answer the availability endpoint
    // owes the caller — "you already started this" rather than "nobody has
    // this" — and a filter miss would skip the lookup that distinguishes them.
    await this.emailBloomService.add(signup.email);
  }

  async read(email: string): Promise<PendingLocalSignupRecord | null> {
    return this.cacheService.getJson<PendingLocalSignupRecord>(
      this.getKey(email),
    );
  }

  async delete(email: string): Promise<void> {
    const pendingSignup = await this.read(email);

    if (pendingSignup) {
      await this.cacheService.delete(
        this.getUsernameKey(pendingSignup.username),
      );
    }

    await this.cacheService.delete(this.getKey(email));
  }

  async readEmailByUsername(username: string): Promise<string | null> {
    return this.cacheService.getJson<string>(this.getUsernameKey(username));
  }

  /**
   * Held across verification so two confirmations of the same code cannot both
   * pass the "does this user exist yet" check and create two rows.
   */
  acquireVerificationLock(email: string) {
    return this.cacheService.acquireLock(
      this.getVerifyLockKey(email),
      PENDING_LOCAL_SIGNUP_VERIFY_LOCK_TTL_IN_MS,
    );
  }

  private getKey(email: string): string {
    return getPendingSignupKey(email);
  }

  private getUsernameKey(username: string): string {
    return getPendingSignupUsernameKey(username);
  }

  private getVerifyLockKey(email: string): string {
    return `${PENDING_LOCAL_SIGNUP_VERIFY_LOCK_PREFIX}:${email.toLowerCase()}`;
  }
}
