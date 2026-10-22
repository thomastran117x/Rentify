import { loggerFactory, type Logger } from "@/configuration/logging";
import type { Uuid } from "@/configuration/validation/uuid";
import ConflictError from "@/errors/http/conflict.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type {
  AccountStatusChangeInput,
  AccountStatusChangeResult,
} from "@/features/auth/account-status/account-status.model";
import type { AccountStatus, AuthUserRecord } from "@/features/auth/auth.model";
import type { AuthAuditEventType } from "@/features/auth/audit/auth-audit.model";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type { TokenService } from "@/features/auth/token/token.service";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { EmailService } from "@/features/email/email.service";

const STATUS_EVENT_TYPES: Record<AccountStatus, AuthAuditEventType> = {
  active: "account.reinstated",
  locked: "account.locked",
  suspended: "account.suspended",
};

/**
 * The one place a durable account status changes. Every change is written to
 * the account, audited and, when the status actually moves, emailed to the
 * user. A lock or suspension also ends every session: the token version is
 * bumped in the same write, which is what stops access and refresh tokens, and
 * the Redis session records are revoked to match. Personal access tokens are
 * stopped by the status itself.
 */
export class AccountStatusService {
  private readonly logger: Logger;

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly tokenService: TokenService,
    private readonly authAuditService: AuthAuditService,
    private readonly emailService: EmailService,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.logger = loggerFactory.forClass(AccountStatusService, "service");
  }

  /**
   * A security hold. Locking an already-locked account records the new reason
   * and ends any session again, but sends no second email. A suspended account
   * cannot be downgraded to a hold the user could clear themself.
   */
  async lock(
    userId: Uuid,
    input: AccountStatusChangeInput,
  ): Promise<AccountStatusChangeResult> {
    const user = await this.requireUser(userId);

    if (user.status === "suspended") {
      throw new ConflictError(
        "A suspended account cannot be put on a security hold. Reinstate it first.",
      );
    }

    return this.applyOrConflict(user, "locked", input);
  }

  async suspend(
    userId: Uuid,
    input: AccountStatusChangeInput,
  ): Promise<AccountStatusChangeResult> {
    return this.applyOrConflict(
      await this.requireUser(userId),
      "suspended",
      input,
    );
  }

  /** Reinstating an active account changes, records and sends nothing. */
  async reinstate(
    userId: Uuid,
    input: AccountStatusChangeInput,
  ): Promise<AccountStatusChangeResult> {
    const user = await this.requireUser(userId);

    if (user.status === "active") {
      const current = await this.usersRepository.findSecurityProfile(userId);

      return {
        userId,
        status: "active",
        statusReason: current?.statusReason ?? null,
        statusChangedAt: current?.statusChangedAt ?? null,
        statusChangedBy: current?.statusChangedBy ?? null,
        changed: false,
      };
    }

    return this.applyOrConflict(user, "active", input);
  }

  /**
   * The user's own recovery: a completed password reset clears a security
   * hold. Only `locked` becomes `active`; an account that is active, or that
   * an admin suspended while the reset was running, is left as it is. Returns
   * the status the account ends up in, which the caller must check before
   * issuing a session.
   */
  async liftSecurityHold(
    userId: Uuid,
    input: Pick<AccountStatusChangeInput, "reason" | "context">,
  ): Promise<AccountStatus> {
    const user = await this.requireUser(userId);

    if (user.status !== "locked") {
      return user.status;
    }

    const result = await this.apply(user, "active", {
      ...input,
      source: "user",
      actorUserId: null,
    });

    return result ? result.status : (await this.requireUser(userId)).status;
  }

  private async applyOrConflict(
    user: AuthUserRecord,
    status: AccountStatus,
    input: AccountStatusChangeInput,
  ): Promise<AccountStatusChangeResult> {
    const result = await this.apply(user, status, input);

    if (!result) {
      throw new ConflictError(
        "This account's status changed while the request was running. Reload it and try again.",
      );
    }

    return result;
  }

  private async requireUser(userId: Uuid): Promise<AuthUserRecord> {
    const user = await this.usersRepository.findUserById(userId);

    if (!user) {
      throw new ResourceNotFoundError("User not found.");
    }

    return user;
  }

  /**
   * Writes the change only while the account is still in the status that was
   * read, and returns null, with nothing written, recorded or sent, when
   * another change got there first.
   */
  private async apply(
    user: AuthUserRecord,
    status: AccountStatus,
    input: AccountStatusChangeInput,
  ): Promise<AccountStatusChangeResult | null> {
    const previousStatus = user.status;
    const changedAt = this.now();
    const changedBy = input.actorUserId ?? null;
    const endsSessions = status !== "active";

    const applied = await this.usersRepository.updateAccountStatus(user.id, {
      expectedStatus: previousStatus,
      status,
      reason: input.reason,
      changedAt,
      changedBy,
      rotateTokenVersion: endsSessions,
    });

    if (!applied) {
      return null;
    }

    if (endsSessions) {
      await this.revokeSessions(user.id);
    }

    await this.authAuditService.recordSafely({
      eventType: STATUS_EVENT_TYPES[status],
      outcome: "success",
      userId: user.id,
      actorUserId: changedBy,
      context: input.context,
      metadata: {
        source: input.source,
        previousStatus,
        reason: input.reason,
      },
    });

    if (previousStatus !== status) {
      await this.sendStatusEmail(user, status);
    }

    return {
      userId: user.id,
      status,
      statusReason: input.reason,
      statusChangedAt: changedAt.toISOString(),
      statusChangedBy: changedBy,
      changed: true,
    };
  }

  /**
   * Best effort: the bumped token version has already ended these sessions,
   * so a Redis failure here must not fail a change that is already committed.
   */
  private async revokeSessions(userId: Uuid): Promise<void> {
    try {
      await this.tokenService.revokeSessionsForUser(userId);
    } catch (error) {
      this.logger.error("Failed to revoke sessions after a status change.", {
        userId,
        error,
      });
    }
  }

  /** Best effort, for the same reason as {@link revokeSessions}. */
  private async sendStatusEmail(
    user: AuthUserRecord,
    status: AccountStatus,
  ): Promise<void> {
    const emailInput = { to: user.email, firstName: user.firstName };

    try {
      if (status === "locked") {
        await this.emailService.sendAccountLockedEmail(emailInput);
      } else if (status === "suspended") {
        await this.emailService.sendAccountSuspendedEmail(emailInput);
      } else {
        await this.emailService.sendAccountReinstatedEmail(emailInput);
      }
    } catch (error) {
      this.logger.error("Failed to queue the account status email.", {
        userId: user.id,
        status,
        error,
      });
    }
  }
}
