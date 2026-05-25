import type { EmailQueueService } from "@/features/email/email.queue.service";

export interface SendVerificationEmailInput {
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
}

export class EmailService {
  constructor(private readonly emailQueueService: EmailQueueService) {}

  async sendVerificationEmail(
    input: SendVerificationEmailInput,
  ): Promise<void> {
    await this.emailQueueService.enqueueEmailJob("verification", input);
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
}
