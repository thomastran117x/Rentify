import { loggerFactory, type Logger } from "@/configuration/logging";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";
import ConflictError from "@/errors/http/conflict.error";
import GoneError from "@/errors/http/gone-error";
import type { AccountStatusService } from "@/features/auth/account-status/account-status.service";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";
import { isEligibleForLocalPasswordManagement } from "@/features/auth/local-account-eligibility";
import {
  SELF_LOCK_LINK_EXPIRED_MESSAGE,
  SELF_LOCK_REASON,
  type SelfLockChannel,
  type SelfLockResult,
} from "@/features/auth/self-lock/self-lock.model";
import type { SelfLockTokenStore } from "@/features/auth/self-lock/self-lock-token.store";
import type { UsersRepository } from "@/features/auth/users/users.repository";

const LOCKED: SelfLockResult = { locked: true };

/**
 * "This wasn't me": the account's owner puts it on a security hold, which ends
 * every session, and gets it back by resetting their password. Only accounts
 * that can reset a password can lock themselves, so a self-lock never strands
 * a social-only account behind a hold only an admin could lift.
 */
export class SelfLockService {
  private readonly logger: Logger;

  constructor(
    private readonly selfLockTokenStore: SelfLockTokenStore,
    private readonly usersRepository: UsersRepository,
    private readonly accountStatusService: AccountStatusService,
  ) {
    this.logger = loggerFactory.forClass(SelfLockService, "service");
  }

  /**
   * Locks the account a lock link names. A spent, expired or unknown link is
   * one generic `410`. A valid link always answers the same way, whatever the
   * account's state, so it never reveals whether the account was already held
   * or suspended; neither of those changes.
   */
  async lockWithToken(
    token: string,
    context?: AuthAuditContext,
  ): Promise<SelfLockResult> {
    const payload = await this.selfLockTokenStore.consume(token);

    if (!payload) {
      throw new GoneError(SELF_LOCK_LINK_EXPIRED_MESSAGE);
    }

    const userId = asUuid(payload.userId);
    const user = await this.usersRepository.findUserById(userId);

    if (!user || user.status !== "active") {
      return LOCKED;
    }

    try {
      await this.lock(userId, "email_link", context, payload.sourceEventId);
    } catch (error) {
      // An admin's change landed between the read and the write. Whatever it
      // was, it is at least as strict as a hold, so there is nothing to undo.
      if (!(error instanceof ConflictError)) {
        throw error;
      }

      this.logger.info("Self-lock skipped: the account status changed.", {
        userId,
      });
    }

    return LOCKED;
  }

  /** The signed-in variant, behind a recent MFA step-up in the controller. */
  async lockFromSession(
    userId: Uuid,
    context?: AuthAuditContext,
  ): Promise<SelfLockResult> {
    const user = await this.usersRepository.findUserById(userId);

    if (!user || !isEligibleForLocalPasswordManagement(user)) {
      throw new ConflictError(
        "This account has no password to reset, so it cannot be locked this way. Change your sign-in methods and remove devices you don't recognise instead.",
        { reason: "password_reset_unavailable" },
      );
    }

    await this.lock(userId, "session", context);

    return LOCKED;
  }

  private async lock(
    userId: Uuid,
    channel: SelfLockChannel,
    context: AuthAuditContext | undefined,
    sourceEventId?: string,
  ): Promise<void> {
    await this.accountStatusService.lock(userId, {
      reason: SELF_LOCK_REASON,
      source: "user",
      actorUserId: null,
      context,
      metadata: sourceEventId ? { channel, sourceEventId } : { channel },
    });
  }
}
