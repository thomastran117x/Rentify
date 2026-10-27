import type { EmailQueueService } from "@/features/email/email.queue.service";
import type { Uuid } from "@/configuration/validation/uuid";

export interface SendVerificationEmailInput {
  to: string;
  verificationCode: string;
  firstName?: string;
  expiresInMinutes?: number;
}

export interface SendEmailChangeCodeEmailInput {
  to: string;
  verificationCode: string;
  firstName?: string;
  expiresInMinutes?: number;
}

/**
 * Goes to the address being moved away from, which is the one channel a
 * hijacked session does not control. `newEmail` is already redacted by the
 * caller — telling the old inbox in full where the account is going would hand
 * that same attacker's target to anyone reading over the owner's shoulder, and
 * the owner only needs enough to recognise whether they made the request.
 */
export interface SendEmailChangeNoticeEmailInput {
  to: string;
  newEmail: string;
  firstName?: string;
}

export interface SendMfaStepUpEmailInput {
  to: string;
  verificationCode: string;
  firstName?: string;
}

export interface SendNewDeviceEmailInput {
  to: string;
  firstName?: string;
  deviceLabel?: string;
  ipAddress?: string;
  platform?: string;
  userAgent?: string;
  detectedAt?: Date;
  /** Adds a "This wasn't you? Lock your account" link when present. */
  selfLockToken?: string;
}

/** What suspicious-activity detection saw, which decides the email's wording. */
export type SuspiciousLoginReason = "success_after_failures" | "refresh_reuse";

export interface SendSuspiciousLoginEmailInput {
  to: string;
  firstName?: string;
  reason: SuspiciousLoginReason;
  ipAddress?: string;
  userAgent?: string;
  detectedAt?: Date;
  /** Adds a "This wasn't you? Lock your account" link when present. */
  selfLockToken?: string;
}

/**
 * A durable account status change. The admin's reason is deliberately not
 * part of it: it may be an internal note, so the email explains only what the
 * status means and what to do next.
 */
export interface SendAccountStatusEmailInput {
  to: string;
  firstName?: string;
}

export interface SendLoginUnlockEmailInput {
  to: string;
  unlockCode: string;
  firstName?: string;
}

export interface SendPasswordResetEmailInput {
  to: string;
  resetCode: string;
  firstName?: string;
  expiresInMinutes?: number;
}

export interface SendUsernameReminderEmailInput {
  to: string;
  username: string;
  firstName?: string;
}

export interface SendOrganizationInviteEmailInput {
  to: string;
  organizationName: string;
  inviterName: string;
  role: "primary_manager" | "manager" | "operator";
  token: string;
}

/**
 * Carries ids rather than a rendered recipient: the delivery worker hydrates
 * the message, posting, author, and recipient address from the database when it
 * processes the job, so the email always reflects current data.
 */
export interface SendBookingMessageNotificationEmailInput {
  bookingRequestId: Uuid;
  recipientId: Uuid;
  messageId: Uuid;
}

/**
 * Carries ids rather than a rendered recipient: the delivery worker hydrates the
 * posting, its expiry and the recipient address when it processes the job. That
 * matters more here than elsewhere — a reminder can sit behind a queue backlog
 * while the owner pushes the date out, and an "expiring soon" email about a
 * posting that is no longer expiring is actively misleading.
 */
export interface SendPostingExpiringSoonEmailInput {
  postingId: Uuid;
  recipientId: Uuid;
  expiresAt: string;
}

export interface SendSavedSearchMatchesEmailInput {
  savedSearchId: Uuid;
  recipientId: Uuid;
  /**
   * Identifiers only. The queue job may sit for minutes behind a retry, by
   * which time a posting can be paused or removed, so the composer re-reads
   * every one of these at send time instead of trusting a snapshot.
   */
  postingIds: Uuid[];
  occurredAt: string;
}

export class EmailService {
  constructor(private readonly emailQueueService: EmailQueueService) {}

  async sendVerificationEmail(
    input: SendVerificationEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("verification", input);
  }

  async sendEmailChangeCodeEmail(
    input: SendEmailChangeCodeEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("email_change_code", input);
  }

  async sendEmailChangeNoticeEmail(
    input: SendEmailChangeNoticeEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("email_change_notice", input);
  }

  async sendMfaStepUpEmail(input: SendMfaStepUpEmailInput): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("mfa_step_up", input);
  }

  async sendNewDeviceEmail(input: SendNewDeviceEmailInput): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("new_device", input);
  }

  async sendAccountLockedEmail(
    input: SendAccountStatusEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("account_locked", input);
  }

  /** The confirmation a user gets after locking their own account. */
  async sendAccountSelfLockedEmail(
    input: SendAccountStatusEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("account_self_locked", input);
  }

  async sendAccountSuspendedEmail(
    input: SendAccountStatusEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("account_suspended", input);
  }

  async sendAccountReinstatedEmail(
    input: SendAccountStatusEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("account_reinstated", input);
  }

  /** An alert from suspicious-activity detection, sent to the account owner. */
  async sendSuspiciousLoginEmail(
    input: SendSuspiciousLoginEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("suspicious_login", input);
  }

  async sendLoginUnlockEmail(input: SendLoginUnlockEmailInput): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("login_unlock", input);
  }

  async sendPasswordResetEmail(
    input: SendPasswordResetEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("password_reset", input);
  }

  async sendUsernameReminderEmail(
    input: SendUsernameReminderEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("username_reminder", input);
  }

  async sendOrganizationInviteEmail(
    input: SendOrganizationInviteEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("organization_invite", input);
  }

  async sendBookingMessageNotificationEmail(
    input: SendBookingMessageNotificationEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("booking_message", input);
  }

  async sendSavedSearchMatchesEmail(
    input: SendSavedSearchMatchesEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("saved_search_matches", input);
  }

  async sendPostingExpiringSoonEmail(
    input: SendPostingExpiringSoonEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob(
      "posting_expiring_soon",
      input,
    );
  }
}
