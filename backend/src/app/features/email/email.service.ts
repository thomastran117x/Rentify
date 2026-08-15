import type { EmailQueueService } from "@/features/email/email.queue.service";

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
  bookingRequestId: string;
  recipientId: string;
  messageId: string;
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
}
