import { environment } from "@/configuration/environment";
import { loggerFactory } from "@/configuration/logging";
import { asUuid, newUuid, type Uuid } from "@/configuration/validation/uuid";
import type { AccountStatusService } from "@/features/auth/account-status/account-status.service";
import type {
  AuthAuditEventType,
  RecordedAuthAuditEvent,
} from "@/features/auth/audit/auth-audit.model";
import type {
  AuthAuditEventMatch,
  AuthAuditRepository,
} from "@/features/auth/audit/auth-audit.repository";
import type { AuthIpBlockStore } from "@/features/auth/detection/ip-block.store";
import {
  REPEATED_LOCKOUTS_LOCK_REASON,
  SUSPICIOUS_ACTIVITY_MAX_LISTED_EVENT_IDS,
  SUSPICIOUS_ACTIVITY_MAX_RELATED_EVENTS,
  type SuspiciousActivityAction,
  type SuspiciousActivityDetectionConfig,
  type SuspiciousActivityRule,
} from "@/features/auth/detection/suspicious-activity.model";
import { isEligibleForLocalPasswordManagement } from "@/features/auth/local-account-eligibility";
import { issueSelfLockLinkToken } from "@/features/auth/self-lock/self-lock-link";
import type { SelfLockTokenStore } from "@/features/auth/self-lock/self-lock-token.store";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { CacheService } from "@/features/cache/cache.service";
import {
  countInSlidingWindow,
  recordInSlidingWindow,
} from "@/features/cache/sliding-window-counter";
import type {
  EmailService,
  SuspiciousLoginReason,
} from "@/features/email/email.service";

const COUNTER_KEY_PREFIX = "auth:detection";
const FIRED_KEY_PREFIX = "auth:detection:fired";

/** The attempt that set a lock, which rules (a) and (c) count. */
const TRIGGERED_LOCKOUT: AuthAuditEventMatch = {
  eventType: "login.locked",
  triggeredLockout: true,
};

/** A failed sign-in that was not refused outright, which (b) and (c) count. */
const SIGN_IN_FAILURE: AuthAuditEventMatch = {
  eventType: "login.failed",
  outcome: "failure",
};

/** The successes rule (c) checks, once a sign-in has completed. */
const SIGN_IN_SUCCESS_EVENT_TYPES: readonly AuthAuditEventType[] = [
  "login.succeeded",
  "oauth.login.succeeded",
];

export interface SuspiciousActivityDetectorDependencies {
  cache: Pick<CacheService, "eval" | "setIfNotExists">;
  repository: Pick<
    AuthAuditRepository,
    "create" | "findRecentEventIds" | "flagEvents"
  >;
  accountStatusService: Pick<AccountStatusService, "lock">;
  usersRepository: Pick<UsersRepository, "findUserById">;
  emailService: Pick<EmailService, "sendSuspiciousLoginEmail">;
  selfLockTokenStore: Pick<SelfLockTokenStore, "issue">;
  ipBlockStore: Pick<AuthIpBlockStore, "block">;
  getConfig?: () => SuspiciousActivityDetectionConfig;
  now?: () => Date;
}

/** One rule crossing its threshold, before dedupe. */
interface Firing {
  rule: SuspiciousActivityRule;
  /** What the rule counts per: a user id, or an IP address for (b). */
  subject: string;
  trigger: RecordedAuthAuditEvent;
  windowSeconds: number;
  count: number;
  threshold: number;
  /**
   * Where the events behind the firing are looked up: the same events the
   * rule's counter counted, so the flags and `relatedEventIds` name them.
   */
  related: {
    userId?: Uuid;
    ipAddress?: string;
    matches: readonly AuthAuditEventMatch[];
    /** Events found some other way, flagged with the trigger. */
    eventIds?: readonly string[];
  };
  /** Takes the rule's action and says what it did. */
  act: (suspiciousEventId: Uuid) => Promise<SuspiciousActivityAction>;
}

/**
 * Watches auth audit events for suspicious sign-in activity. `AuthAuditService`
 * calls `handle` after each write, without waiting, so nothing here can slow
 * or change an auth response. Counters are Redis sliding windows; when Redis
 * or the database fails, detection for that event is skipped and logged.
 *
 * In alert mode a firing records a `security.suspicious_activity` event,
 * flags the events behind it, and emails the user for rules (c) and (d). In
 * enforce mode rule (a) also locks the account and rule (b) blocks the IP.
 * See docs/auth-security.md#suspicious-activity-detection.
 */
export class SuspiciousActivityDetector {
  private readonly logger = loggerFactory.forClass(
    SuspiciousActivityDetector,
    "service",
  );
  private readonly getConfig: () => SuspiciousActivityDetectionConfig;
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: SuspiciousActivityDetectorDependencies,
  ) {
    this.getConfig =
      dependencies.getConfig ??
      (() => environment.getAuthSecurityConfig().detection);
    this.now = dependencies.now ?? (() => new Date());
  }

  /** The `AuthAuditListener`; never throws. */
  handle = async (event: RecordedAuthAuditEvent): Promise<void> => {
    const config = this.getConfig();

    if (config.mode === "off") {
      return;
    }

    try {
      await this.evaluate(event, config);
    } catch (error) {
      this.logger.warn("Suspicious activity detection skipped.", {
        eventType: event.eventType,
        eventId: event.id,
        error,
      });
    }
  };

  private async evaluate(
    event: RecordedAuthAuditEvent,
    config: SuspiciousActivityDetectionConfig,
  ): Promise<void> {
    switch (event.eventType) {
      case "login.locked":
        // Only the attempt that set the lock; later refusals of a locked
        // account are not new lockouts.
        if (event.metadata?.triggered === true && event.userId) {
          await this.countRepeatedLockouts(event, event.userId, config);
          await this.countSignInFailure(event, event.userId, config);
        }
        return;
      case "login.failed":
        if (event.outcome !== "failure") {
          return;
        }
        await this.countCredentialStuffing(event, config);
        if (event.userId) {
          await this.countSignInFailure(event, event.userId, config);
        }
        return;
      case "login.succeeded":
      case "oauth.login.succeeded":
        if (event.userId) {
          await this.checkSuccessAfterFailures(event, event.userId, config);
        }
        return;
      case "session.refresh_reuse_detected":
        if (event.userId) {
          await this.reportRefreshReuse(event, event.userId, config);
        }
        return;
      default:
        return;
    }
  }

  /** Rule (a): repeated lockouts of one account. */
  private async countRepeatedLockouts(
    event: RecordedAuthAuditEvent,
    userId: Uuid,
    config: SuspiciousActivityDetectionConfig,
  ): Promise<void> {
    const rule = config.repeatedLockouts;

    if (!rule.enabled) {
      return;
    }

    const windowSeconds = rule.windowMinutes * 60;
    const count = await recordInSlidingWindow(
      this.dependencies.cache,
      this.counterKey("repeated_lockouts", userId),
      event.id,
      windowSeconds,
      this.now().getTime(),
    );

    if (count < rule.threshold) {
      return;
    }

    await this.fire(config, {
      rule: "repeated_lockouts",
      subject: userId,
      trigger: event,
      windowSeconds,
      count,
      threshold: rule.threshold,
      related: { userId, matches: [TRIGGERED_LOCKOUT] },
      act: async (suspiciousEventId) =>
        config.mode === "enforce"
          ? this.lockAccount(userId, event, suspiciousEventId)
          : "none",
    });
  }

  /** Rule (b): many distinct sign-in names failing from one IP. */
  private async countCredentialStuffing(
    event: RecordedAuthAuditEvent,
    config: SuspiciousActivityDetectionConfig,
  ): Promise<void> {
    const rule = config.credentialStuffing;
    const ipAddress = event.context?.ipAddress;

    if (!rule.enabled || !ipAddress || !event.identifierHash) {
      return;
    }

    const windowSeconds = rule.windowMinutes * 60;
    const count = await recordInSlidingWindow(
      this.dependencies.cache,
      this.counterKey("credential_stuffing", ipAddress),
      event.identifierHash,
      windowSeconds,
      this.now().getTime(),
    );

    if (count < rule.threshold) {
      return;
    }

    await this.fire(config, {
      rule: "credential_stuffing",
      subject: ipAddress,
      trigger: event,
      windowSeconds,
      count,
      threshold: rule.threshold,
      related: { ipAddress, matches: [SIGN_IN_FAILURE] },
      act: async () => {
        if (config.mode !== "enforce") {
          return "none";
        }

        await this.dependencies.ipBlockStore.block(
          ipAddress,
          rule.blockMinutes * 60,
          this.now(),
        );
        return "ip_blocked";
      },
    });
  }

  /** Rule (c), first half: remembers a failed sign-in for the account. */
  private async countSignInFailure(
    event: RecordedAuthAuditEvent,
    userId: Uuid,
    config: SuspiciousActivityDetectionConfig,
  ): Promise<void> {
    const rule = config.successAfterFailures;

    if (!rule.enabled) {
      return;
    }

    await recordInSlidingWindow(
      this.dependencies.cache,
      this.counterKey("success_after_failures", userId),
      event.id,
      rule.windowMinutes * 60,
      this.now().getTime(),
    );
  }

  /**
   * Rule (c), second half, on a completed sign-in. It counts only when the
   * same request also recorded `device.new_detected`, which a sign-in writes
   * for a device the account has not used on an IP it has not used either.
   * Keying on the request matters: refreshing a session can record
   * `device.new_detected` too, and is not a sign-in.
   */
  private async checkSuccessAfterFailures(
    event: RecordedAuthAuditEvent,
    userId: Uuid,
    config: SuspiciousActivityDetectionConfig,
  ): Promise<void> {
    const rule = config.successAfterFailures;
    const requestId = event.context?.requestId;

    if (!rule.enabled || !requestId) {
      return;
    }

    const windowSeconds = rule.windowMinutes * 60;
    const count = await countInSlidingWindow(
      this.dependencies.cache,
      this.counterKey("success_after_failures", userId),
      windowSeconds,
      this.now().getTime(),
    );

    if (count < rule.threshold) {
      return;
    }

    // The sign-in awaits that write before recording its success, so the
    // row is already there.
    const newDeviceEventIds =
      await this.dependencies.repository.findRecentEventIds({
        userId,
        requestId,
        matches: [{ eventType: "device.new_detected" }],
        createdFrom: new Date(this.now().getTime() - windowSeconds * 1000),
        limit: 1,
      });

    if (newDeviceEventIds.length === 0) {
      return;
    }

    await this.fire(config, {
      rule: "success_after_failures",
      subject: userId,
      trigger: event,
      windowSeconds,
      count,
      threshold: rule.threshold,
      related: {
        userId,
        matches: [SIGN_IN_FAILURE, TRIGGERED_LOCKOUT],
        eventIds: newDeviceEventIds,
      },
      act: (suspiciousEventId) =>
        this.emailUser(
          userId,
          event,
          suspiciousEventId,
          "success_after_failures",
        ),
    });
  }

  /** Rule (d): any refresh-token reuse. */
  private async reportRefreshReuse(
    event: RecordedAuthAuditEvent,
    userId: Uuid,
    config: SuspiciousActivityDetectionConfig,
  ): Promise<void> {
    const rule = config.refreshReuse;

    if (!rule.enabled) {
      return;
    }

    await this.fire(config, {
      rule: "refresh_reuse",
      subject: userId,
      trigger: event,
      windowSeconds: rule.windowMinutes * 60,
      count: 1,
      threshold: 1,
      related: { matches: [] },
      act: (suspiciousEventId) =>
        this.emailUser(userId, event, suspiciousEventId, "refresh_reuse"),
    });
  }

  /**
   * Acts on a firing at most once per rule, subject and window: a second
   * firing inside the window records, flags, locks and emails nothing.
   */
  private async fire(
    config: SuspiciousActivityDetectionConfig,
    firing: Firing,
  ): Promise<void> {
    const claimed = await this.dependencies.cache.setIfNotExists(
      `${FIRED_KEY_PREFIX}:${firing.rule}:${firing.subject}`,
      "1",
      firing.windowSeconds,
    );

    if (!claimed) {
      return;
    }

    const now = this.now();
    const suspiciousEventId = newUuid();
    const relatedIds = await this.findRelatedEventIds(firing, now);
    const action = await this.runAction(firing, suspiciousEventId);

    await this.dependencies.repository.create({
      id: suspiciousEventId,
      eventType: "security.suspicious_activity",
      outcome:
        action === "account_locked" || action === "ip_blocked"
          ? "blocked"
          : "failure",
      userId:
        firing.rule === "credential_stuffing" ? null : asUuid(firing.subject),
      context: firing.trigger.context,
      flagged: true,
      metadata: {
        rule: firing.rule,
        mode: config.mode,
        action,
        windowSeconds: firing.windowSeconds,
        count: firing.count,
        threshold: firing.threshold,
        relatedEventCount: relatedIds.length,
        relatedEventIds: relatedIds
          .slice(0, SUSPICIOUS_ACTIVITY_MAX_LISTED_EVENT_IDS)
          .join(","),
      },
    });
    await this.dependencies.repository.flagEvents(relatedIds);

    this.logger.warn("Suspicious activity detected.", {
      rule: firing.rule,
      mode: config.mode,
      action,
      count: firing.count,
      threshold: firing.threshold,
      windowSeconds: firing.windowSeconds,
      userId: firing.trigger.userId ?? undefined,
      ipAddress: firing.trigger.context?.ipAddress,
      eventId: suspiciousEventId,
      triggeringEventId: firing.trigger.id,
    });
  }

  /**
   * The triggering event first, then any found with it, then the newest
   * others the rule counted.
   */
  private async findRelatedEventIds(
    firing: Firing,
    now: Date,
  ): Promise<string[]> {
    const ids = new Set<string>([
      firing.trigger.id,
      ...(firing.related.eventIds ?? []),
    ]);

    if (firing.related.matches.length > 0) {
      const found = await this.dependencies.repository.findRecentEventIds({
        ...(firing.related.userId ? { userId: firing.related.userId } : {}),
        ...(firing.related.ipAddress
          ? { ipAddress: firing.related.ipAddress }
          : {}),
        matches: firing.related.matches,
        createdFrom: new Date(now.getTime() - firing.windowSeconds * 1000),
        limit: SUSPICIOUS_ACTIVITY_MAX_RELATED_EVENTS,
      });

      for (const id of found) {
        ids.add(id);
      }
    }

    return [...ids].slice(0, SUSPICIOUS_ACTIVITY_MAX_RELATED_EVENTS);
  }

  /**
   * An action that fails is logged and recorded as `failed`; the firing is
   * still recorded and flagged, so an admin sees it.
   */
  private async runAction(
    firing: Firing,
    suspiciousEventId: Uuid,
  ): Promise<SuspiciousActivityAction> {
    try {
      return await firing.act(suspiciousEventId);
    } catch (error) {
      this.logger.error("Suspicious activity action failed.", {
        rule: firing.rule,
        eventId: suspiciousEventId,
        error,
      });
      return "failed";
    }
  }

  /**
   * Rule (a)'s enforce action. Only an active account that can recover by
   * resetting its password is locked: a held one stays as it is, a suspension
   * is never downgraded to a hold, and a provider-only account is left alone.
   */
  private async lockAccount(
    userId: Uuid,
    trigger: RecordedAuthAuditEvent,
    suspiciousEventId: Uuid,
  ): Promise<SuspiciousActivityAction> {
    const user = await this.dependencies.usersRepository.findUserById(userId);

    // The only way out of a hold without an admin is a password reset, so an
    // account that cannot reset one (no password, or an unverified email) is
    // never held automatically. Its lockouts are still recorded and flagged.
    if (
      !user ||
      user.status !== "active" ||
      !isEligibleForLocalPasswordManagement(user)
    ) {
      return "skipped";
    }

    await this.dependencies.accountStatusService.lock(userId, {
      reason: REPEATED_LOCKOUTS_LOCK_REASON,
      source: "system",
      context: trigger.context,
      metadata: {
        rule: "repeated_lockouts",
        sourceEventId: suspiciousEventId,
      },
    });
    return "account_locked";
  }

  /** Rules (c) and (d): one `suspicious_login` email with a lock link. */
  private async emailUser(
    userId: Uuid,
    trigger: RecordedAuthAuditEvent,
    suspiciousEventId: Uuid,
    reason: SuspiciousLoginReason,
  ): Promise<SuspiciousActivityAction> {
    const user = await this.dependencies.usersRepository.findUserById(userId);

    if (!user) {
      return "skipped";
    }

    const selfLockToken = await issueSelfLockLinkToken(
      this.dependencies.selfLockTokenStore,
      user,
      suspiciousEventId,
      this.logger,
    );

    await this.dependencies.emailService.sendSuspiciousLoginEmail({
      to: user.email,
      firstName: user.firstName,
      reason,
      ipAddress: trigger.context?.ipAddress,
      userAgent: trigger.context?.userAgent,
      detectedAt: this.now(),
      ...(selfLockToken ? { selfLockToken } : {}),
    });
    return "email_sent";
  }

  private counterKey(rule: SuspiciousActivityRule, subject: string): string {
    return `${COUNTER_KEY_PREFIX}:${rule}:${subject}`;
  }
}
