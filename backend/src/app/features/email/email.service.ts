import type { EmailQueueService } from "@/features/email/email.queue.service";
import type { Uuid } from "@/configuration/validation/uuid";

export interface SendVerificationEmailInput {
  to: string;
  verificationCode: string;
  firstName?: string;
  expiresInMinutes?: number;
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

  async sendMfaStepUpEmail(input: SendMfaStepUpEmailInput): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("mfa_step_up", input);
  }

  async sendNewDeviceEmail(input: SendNewDeviceEmailInput): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("new_device", input);
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
