import { createHash } from "node:crypto";
import { loggerFactory } from "@/configuration/logging";
import type { Uuid } from "@/configuration/validation/uuid";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";
import { parseUserAgent } from "@/features/auth/audit/auth-audit-activity";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import { issueSelfLockLinkToken } from "@/features/auth/self-lock/self-lock-link";
import type { SelfLockTokenStore } from "@/features/auth/self-lock/self-lock-token.store";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { CacheService } from "@/features/cache/cache.service";
import type {
  EmailService,
  SecurityChangeEmailBase,
  SecurityChangeEmailInputByKind,
  SecurityChangeEmailKind,
} from "@/features/email/email.service";

/** What became of the email, recorded as the audit event's `emailNotification`. */
export type SecurityEmailOutcome = "sent" | "suppressed" | "skipped" | "failed";

/** Allowance per kind and inbox: enough that one person's changes all arrive. */
export const SECURITY_EMAIL_LIMIT = 3;
export const SECURITY_EMAIL_LIMIT_WINDOW_SECONDS = 60 * 60;

/**
 * Counts one email and starts the window on the first. One step, so a crash
 * between the two cannot leave a counter that never expires and silences the
 * address for good.
 */
export const SECURITY_EMAIL_COUNT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

/** A change, with whatever its email says beyond the fields every one has. */
export type SecurityChange = {
  [TKind in SecurityChangeEmailKind]: {
    kind: TKind;
    details: Omit<
      SecurityChangeEmailInputByKind[TKind],
      keyof SecurityChangeEmailBase
    >;
  };
}[SecurityChangeEmailKind];

export type SecurityNotificationInput = SecurityChange & {
  userId: Uuid;
  /** The audit event being recorded for the change, named by the lock link. */
  eventId: Uuid;
  context?: AuthAuditContext;
  /**
   * Who to tell, when it is not the address on the account. An email change is
   * announced to the address the account just left.
   */
  recipient?: Pick<AuthUserRecord, "email" | "emailVerified">;
};

interface SecurityNotificationServiceOptions {
  usersRepository: Pick<UsersRepository, "findUserById">;
  emailService: Pick<EmailService, "sendSecurityChangeEmail">;
  cache: Pick<CacheService, "eval">;
  selfLockTokenStore: Pick<SelfLockTokenStore, "issue">;
  now?: () => Date;
}

/**
 * Tells an account's owner about a security change that has already happened.
 *
 * `notify` never throws: the change is committed by the time it runs, and
 * nothing here may fail or undo it. The caller records the returned outcome on
 * the change's audit event, so a missing email can be explained afterwards.
 *
 * Security emails are not optional, so there is no preference to check. The
 * only reasons one does not go out are that the address was never proven, or
 * that the same inbox has already had its allowance of this kind.
 */
export class SecurityNotificationService {
  private readonly logger = loggerFactory.forClass(
    SecurityNotificationService,
    "service",
  );
  private readonly usersRepository: SecurityNotificationServiceOptions["usersRepository"];
  private readonly emailService: SecurityNotificationServiceOptions["emailService"];
  private readonly cache: SecurityNotificationServiceOptions["cache"];
  private readonly selfLockTokenStore: SecurityNotificationServiceOptions["selfLockTokenStore"];
  private readonly now: () => Date;

  constructor(options: SecurityNotificationServiceOptions) {
    this.usersRepository = options.usersRepository;
    this.emailService = options.emailService;
    this.cache = options.cache;
    this.selfLockTokenStore = options.selfLockTokenStore;
    this.now = options.now ?? (() => new Date());
  }

  async notify(
    input: SecurityNotificationInput,
  ): Promise<SecurityEmailOutcome> {
    try {
      return await this.send(input);
    } catch (error) {
      this.logger.error("Failed to queue a security email.", {
        userId: input.userId,
        kind: input.kind,
        error,
      });
      return "failed";
    }
  }

  private async send(
    input: SecurityNotificationInput,
  ): Promise<SecurityEmailOutcome> {
    const user = await this.usersRepository.findUserById(input.userId);

    if (!user) {
      throw new Error("The account to notify no longer exists.");
    }

    const recipient = input.recipient ?? user;

    if (!recipient.emailVerified) {
      this.logger.info("Security email skipped: the address is unverified.", {
        userId: input.userId,
        kind: input.kind,
      });
      return "skipped";
    }

    if (!(await this.withinLimit(input.kind, recipient.email, input.userId))) {
      this.logger.info("Security email suppressed by its rate limit.", {
        userId: input.userId,
        kind: input.kind,
      });
      return "suppressed";
    }

    const selfLockToken = await issueSelfLockLinkToken(
      this.selfLockTokenStore,
      user,
      input.eventId,
      this.logger,
    );
    const device = describeDevice(input.context?.userAgent);
    const base: SecurityChangeEmailBase = {
      to: recipient.email,
      firstName: user.firstName,
      occurredAt: this.now().toISOString(),
      ...(input.context?.ipAddress
        ? { ipAddress: input.context.ipAddress }
        : {}),
      ...(device ? { device } : {}),
      ...(selfLockToken ? { selfLockToken } : {}),
    };

    await this.emailService.sendSecurityChangeEmail(input.kind, {
      ...base,
      ...input.details,
    } as SecurityChangeEmailInputByKind[typeof input.kind]);

    return "sent";
  }

  /**
   * Fails open: losing Redis must not silence an alert, and the first email of
   * a kind always goes out. Keyed on the inbox rather than the account, so one
   * account moving between addresses is not limited across them.
   */
  private async withinLimit(
    kind: SecurityChangeEmailKind,
    email: string,
    userId: Uuid,
  ): Promise<boolean> {
    const inbox = createHash("sha256")
      .update(email.trim().toLowerCase())
      .digest("hex");

    try {
      const count = await this.cache.eval<number>(
        SECURITY_EMAIL_COUNT_SCRIPT,
        [`auth:security-email:${kind}:${inbox}`],
        [String(SECURITY_EMAIL_LIMIT_WINDOW_SECONDS)],
      );

      return count <= SECURITY_EMAIL_LIMIT;
    } catch (error) {
      this.logger.warn("Security email rate limit unavailable.", {
        userId,
        kind,
        error,
      });
      return true;
    }
  }
}

/** "Chrome on Windows", or as much of it as the user agent gives away. */
function describeDevice(userAgent: string | undefined): string | undefined {
  const { browser, os } = parseUserAgent(userAgent);

  if (browser && os) {
    return `${browser} on ${os}`;
  }

  return browser ?? os ?? undefined;
}
