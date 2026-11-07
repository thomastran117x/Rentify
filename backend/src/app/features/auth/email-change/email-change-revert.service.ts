import { createHash, randomBytes } from "node:crypto";
import { loggerFactory, type Logger } from "@/configuration/logging";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";
import ConflictError from "@/errors/http/conflict.error";
import GoneError from "@/errors/http/gone-error";
import type { AccountStatusService } from "@/features/auth/account-status/account-status.service";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type { EmailChangeRevertRepository } from "@/features/auth/email-change/email-change-revert.repository";
import {
  EMAIL_CHANGE_REVERT_LINK_EXPIRED_MESSAGE,
  EMAIL_CHANGE_REVERT_REASON,
  EMAIL_CHANGE_REVERT_TTL_SECONDS,
  type EmailChangeRevertRecord,
  type EmailChangeRevertResult,
} from "@/features/auth/email-change/email-change.model";
import type { EmailChangeStore } from "@/features/auth/email-change/email-change.store";
import { isLocalPasswordAccount } from "@/features/auth/local-account-eligibility";
import { redactEmail } from "@/features/auth/redact-email";
import type { TokenService } from "@/features/auth/token/token.service";
import type { UsersRepository } from "@/features/auth/users/users.repository";

export interface IssueEmailChangeRevertInput {
  userId: Uuid;
  oldEmail: string;
  newEmail: string;
  sourceEventId: Uuid;
}

export function hashEmailChangeRevertToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The link in an `email_changed` email: the way back for an owner whose address
 * was changed by someone else. Using it puts the old address back and ends every
 * session, which is what removes whoever made the change.
 *
 * Only the token's hash is stored, so a database dump yields no working links.
 * The token is not tied to a session, since the owner may well have been signed
 * out by the change it undoes.
 */
export class EmailChangeRevertService {
  private readonly logger: Logger;

  constructor(
    private readonly repository: EmailChangeRevertRepository,
    private readonly emailChangeStore: EmailChangeStore,
    private readonly usersRepository: UsersRepository,
    private readonly accountStatusService: AccountStatusService,
    private readonly tokenService: TokenService,
    private readonly authAuditService: AuthAuditService,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.logger = loggerFactory.forClass(EmailChangeRevertService, "service");
  }

  /** Best effort: losing the link must not cost the owner the alert. */
  async issue(input: IssueEmailChangeRevertInput): Promise<string | undefined> {
    const token = randomBytes(32).toString("base64url");
    const now = this.now();

    try {
      await this.repository.replaceOpenForUser(
        {
          ...input,
          tokenHash: hashEmailChangeRevertToken(token),
          expiresAt: new Date(
            now.getTime() + EMAIL_CHANGE_REVERT_TTL_SECONDS * 1000,
          ),
        },
        now,
      );

      return token;
    } catch (error) {
      this.logger.error("Failed to issue an email change revert link.", {
        userId: input.userId,
        error,
      });
      return undefined;
    }
  }

  /**
   * A spent, expired, superseded or unknown link is one generic `410`. A link
   * that was claimed but could not be acted on, such as during a database
   * outage, is put back so the owner can retry it.
   */
  async revert(
    token: string,
    context?: AuthAuditContext,
  ): Promise<EmailChangeRevertResult> {
    const record = await this.repository.claim(
      hashEmailChangeRevertToken(token),
      this.now(),
    );

    if (!record) {
      throw new GoneError(EMAIL_CHANGE_REVERT_LINK_EXPIRED_MESSAGE);
    }

    try {
      return await this.revertClaimed(record, context);
    } catch (error) {
      if (!(error instanceof GoneError)) {
        await this.releaseLink(record.id);
      }

      throw error;
    }
  }

  async pruneExpired(): Promise<number> {
    return this.repository.deleteExpired(this.now());
  }

  /**
   * Held under the lock `EmailChangeService.confirmChange` takes, because that
   * write is unconditional: finishing after this one, it would move the
   * account straight off the address just restored.
   */
  private async revertClaimed(
    record: EmailChangeRevertRecord,
    context: AuthAuditContext | undefined,
  ): Promise<EmailChangeRevertResult> {
    const userId = asUuid(record.userId);
    const lock = await this.emailChangeStore.acquireConfirmLock(userId);

    if (!lock) {
      throw new ConflictError(
        "This account's email is changing right now. Try the link again.",
      );
    }

    try {
      const user = await this.usersRepository.findUserById(userId);

      // Only the change the link was sent about can be undone. Anything since
      // then was a newer decision that this older link must not overrule.
      if (!user || user.email !== record.newEmail) {
        throw new GoneError(EMAIL_CHANGE_REVERT_LINK_EXPIRED_MESSAGE);
      }

      const canReset =
        isLocalPasswordAccount(user) && user.status !== "suspended";

      if (canReset) {
        await this.accountStatusService.lock(userId, {
          reason: EMAIL_CHANGE_REVERT_REASON,
          source: "user",
          actorUserId: null,
          context,
          metadata: {
            channel: "email_revert",
            sourceEventId: record.sourceEventId,
          },
          restoreEmail: { from: record.newEmail, to: record.oldEmail },
        });
      } else {
        await this.restoreWithoutHold(record, userId);
      }

      await this.discardPendingChange(userId);
      await this.authAuditService.recordSafely({
        eventType: "email.change_reverted",
        outcome: "success",
        userId,
        context,
        metadata: {
          oldEmailMasked: redactEmail(record.oldEmail),
          newEmailMasked: redactEmail(record.newEmail),
          sourceEventId: record.sourceEventId,
        },
      });

      return {
        reverted: true,
        nextStep: canReset ? "reset_password" : "sign_in",
      };
    } finally {
      await lock.release();
    }
  }

  /**
   * For an account a hold would strand: one with no password to reset can only
   * have a hold lifted by an admin, and a suspended one must never be
   * downgraded to a hold. Bumping the token version still ends every session.
   */
  private async restoreWithoutHold(
    record: EmailChangeRevertRecord,
    userId: Uuid,
  ): Promise<void> {
    const restored = await this.usersRepository.restoreEmail(userId, {
      from: record.newEmail,
      to: record.oldEmail,
    });

    if (!restored) {
      throw new GoneError(EMAIL_CHANGE_REVERT_LINK_EXPIRED_MESSAGE);
    }

    // Best effort: the bumped token version has already ended these sessions.
    try {
      await this.tokenService.revokeSessionsForUser(userId);
    } catch (error) {
      this.logger.error("Failed to revoke sessions after an email revert.", {
        userId,
        error,
      });
    }
  }

  /** Best effort: the address is already back, and this only tidies Redis. */
  private async discardPendingChange(userId: Uuid): Promise<void> {
    try {
      await this.emailChangeStore.clear(userId);
    } catch (error) {
      this.logger.error("Failed to clear a pending change after a revert.", {
        userId,
        error,
      });
    }
  }

  /** Best effort: the original failure is the one worth reporting. */
  private async releaseLink(id: string): Promise<void> {
    try {
      await this.repository.release(id);
    } catch (error) {
      this.logger.error("Failed to release an email change revert link.", {
        error,
      });
    }
  }
}
