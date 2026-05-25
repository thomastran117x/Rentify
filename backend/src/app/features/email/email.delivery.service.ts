import {
  getEnvironmentVariable,
  getOptionalEnvironmentVariable,
} from "@/configuration/environment";
import type { EmailJobPayload } from "@/features/email/email.model";
import type {
  SendLoginUnlockEmailInput,
  SendNewDeviceEmailInput,
  SendPasswordResetEmailInput,
  SendVerificationEmailInput,
} from "@/features/email/email.service";
import nodemailer, { type Transporter } from "nodemailer";

interface EmailDeliveryServiceOptions {
  transporter?: Transporter;
  gmailUser?: string;
  gmailAppPassword?: string;
  fromEmail?: string;
  fromName?: string;
  appBaseUrl?: string;
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const DEFAULTS = {
  maxRetries: 3,
  initialDelayMs: 250,
  maxDelayMs: 2_000,
  backoffMultiplier: 2,
} as const;

const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNECTION",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ESOCKET",
  "SMTPConnectionError",
]);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export class EmailDeliveryService {
  private readonly transporter: Transporter;
  private readonly fromEmail: string;
  private readonly fromName: string;
  private readonly appBaseUrl: string;
  private readonly maxRetries: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly backoffMultiplier: number;

  constructor(options: EmailDeliveryServiceOptions = {}) {
    const gmailUser = options.gmailUser ?? getEnvironmentVariable("GMAIL_USER");
    const gmailAppPassword =
      options.gmailAppPassword ?? getEnvironmentVariable("GMAIL_APP_PASSWORD");

    this.transporter =
      options.transporter ??
      nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: gmailUser,
          pass: gmailAppPassword,
        },
      });

    this.fromEmail =
      options.fromEmail ??
      getOptionalEnvironmentVariable("EMAIL_FROM") ??
      gmailUser;
    this.fromName =
      options.fromName ??
      getOptionalEnvironmentVariable("EMAIL_FROM_NAME") ??
      "Rent";
    this.appBaseUrl = trimTrailingSlash(
      options.appBaseUrl ??
        getOptionalEnvironmentVariable("APP_BASE_URL") ??
        getOptionalEnvironmentVariable("FRONTEND_URL") ??
        "http://localhost:3000",
    );
    this.maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    this.initialDelayMs = options.initialDelayMs ?? DEFAULTS.initialDelayMs;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
    this.backoffMultiplier =
      options.backoffMultiplier ?? DEFAULTS.backoffMultiplier;
  }

  async deliver(payload: EmailJobPayload): Promise<void> {
    switch (payload.kind) {
      case "verification":
        await this.sendVerificationEmail(payload.input);
        return;
      case "new_device":
        await this.sendNewDeviceEmail(payload.input);
        return;
      case "login_unlock":
        await this.sendLoginUnlockEmail(payload.input);
        return;
      case "password_reset":
        await this.sendPasswordResetEmail(payload.input);
        return;
    }
  }

  async sendVerificationEmail(
    input: SendVerificationEmailInput,
  ): Promise<void> {
    const greetingName = this.resolveGreetingName(input.firstName);
    const escapedGreetingName = escapeHtml(greetingName);
    const escapedVerificationCode = escapeHtml(input.verificationCode);

    await this.sendWithRetry({
      to: input.to,
      subject: "Verify your email address",
      text: [
        `Hi ${greetingName},`,
        "",
        "Welcome to Rent. Please verify your email address to finish setting up your account.",
        "",
        `Verification code: ${input.verificationCode}`,
        "",
        "This code expires soon. If you did not create this account, you can safely ignore this email.",
      ].join("\n"),
      html: [
        `<p>Hi ${escapedGreetingName},</p>`,
        "<p>Welcome to Rent. Please verify your email address to finish setting up your account.</p>",
        `<p>Your verification code is:</p><p style="font-size: 28px; font-weight: 700; letter-spacing: 0.3em;">${escapedVerificationCode}</p>`,
        "<p>This code expires soon. If you did not create this account, you can safely ignore this email.</p>",
      ].join(""),
    });
  }

  async sendNewDeviceEmail(input: SendNewDeviceEmailInput): Promise<void> {
    const greetingName = this.resolveGreetingName(input.firstName);
    const detectedAt =
      input.detectedAt instanceof Date
        ? input.detectedAt
        : typeof input.detectedAt === "string"
          ? new Date(input.detectedAt)
          : new Date();
    const details = this.buildDeviceDetails(input, detectedAt);
    const htmlDetails = details
      .map((detail) => `<li>${escapeHtml(detail)}</li>`)
      .join("");

    await this.sendWithRetry({
      to: input.to,
      subject: "New device sign-in detected",
      text: [
        `Hi ${greetingName},`,
        "",
        "We noticed a sign-in from a new device on your account.",
        "",
        ...details.map((detail) => `- ${detail}`),
        "",
        "If this was you, no action is needed.",
        "If this wasn't you, please change your password and review account access immediately.",
      ].join("\n"),
      html: [
        `<p>Hi ${escapeHtml(greetingName)},</p>`,
        "<p>We noticed a sign-in from a new device on your account.</p>",
        `<ul>${htmlDetails}</ul>`,
        "<p>If this was you, no action is needed.</p>",
        "<p>If this wasn't you, please change your password and review account access immediately.</p>",
      ].join(""),
    });
  }

  async sendLoginUnlockEmail(input: SendLoginUnlockEmailInput): Promise<void> {
    const greetingName = this.resolveGreetingName(input.firstName);
    const escapedGreetingName = escapeHtml(greetingName);
    const escapedUnlockCode = escapeHtml(input.unlockCode);

    await this.sendWithRetry({
      to: input.to,
      subject: "Unlock your Rent sign-in",
      text: [
        `Hi ${greetingName},`,
        "",
        "We temporarily locked local sign-in after too many unsuccessful password attempts.",
        "",
        `Unlock code: ${input.unlockCode}`,
        "",
        "Enter this code on the unlock screen to restore access.",
        "If this wasn't you, you can ignore this email and consider changing your password.",
      ].join("\n"),
      html: [
        `<p>Hi ${escapedGreetingName},</p>`,
        "<p>We temporarily locked local sign-in after too many unsuccessful password attempts.</p>",
        "<p>Your unlock code is:</p>",
        `<p style="font-size: 28px; font-weight: 700; letter-spacing: 0.3em;">${escapedUnlockCode}</p>`,
        "<p>Enter this code on the unlock screen to restore access.</p>",
        "<p>If this wasn't you, you can ignore this email and consider changing your password.</p>",
      ].join(""),
    });
  }

  async sendPasswordResetEmail(
    input: SendPasswordResetEmailInput,
  ): Promise<void> {
    const greetingName = this.resolveGreetingName(input.firstName);
    const escapedGreetingName = escapeHtml(greetingName);
    const escapedResetCode = escapeHtml(input.resetCode);

    await this.sendWithRetry({
      to: input.to,
      subject: "Reset your Rent password",
      text: [
        `Hi ${greetingName},`,
        "",
        "We received a request to reset your password.",
        "",
        `Reset code: ${input.resetCode}`,
        "",
        "Enter this code to choose a new password.",
        "If you didn't request this, you can ignore this email.",
      ].join("\n"),
      html: [
        `<p>Hi ${escapedGreetingName},</p>`,
        "<p>We received a request to reset your password.</p>",
        "<p>Your reset code is:</p>",
        `<p style="font-size: 28px; font-weight: 700; letter-spacing: 0.3em;">${escapedResetCode}</p>`,
        "<p>Enter this code to choose a new password.</p>",
        "<p>If you didn't request this, you can ignore this email.</p>",
      ].join(""),
    });
  }

  async verifyConnection(): Promise<void> {
    await this.transporter.verify();
  }

  private async sendWithRetry(message: EmailMessage): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        await this.transporter.sendMail({
          from: this.formatFromHeader(),
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        return;
      } catch (error) {
        lastError = error;

        if (!this.isTransientError(error) || attempt === this.maxRetries) {
          break;
        }

        await this.sleep(this.calculateDelayMs(attempt));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Email delivery failed.");
  }

  private formatFromHeader(): string {
    return `${this.fromName} <${this.fromEmail}>`;
  }

  private resolveGreetingName(firstName?: string): string {
    return firstName?.trim() || "there";
  }

  private buildDeviceDetails(
    input: SendNewDeviceEmailInput,
    detectedAt: Date,
  ): string[] {
    const details = [`Detected at: ${detectedAt.toISOString()}`];

    if (input.deviceLabel) {
      details.push(`Device: ${input.deviceLabel}`);
    }

    if (input.platform) {
      details.push(`Platform: ${input.platform}`);
    }

    if (input.ipAddress) {
      details.push(`IP address: ${input.ipAddress}`);
    }

    if (input.userAgent) {
      details.push(`User agent: ${input.userAgent}`);
    }

    return details;
  }

  private isTransientError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const code =
      "code" in error && typeof error.code === "string"
        ? error.code
        : "command" in error && typeof error.command === "string"
          ? error.command
          : undefined;

    if (code && TRANSIENT_ERROR_CODES.has(code)) {
      return true;
    }

    return /timeout|connection|temporar|rate limit|greeting/i.test(
      error.message,
    );
  }

  private calculateDelayMs(attempt: number): number {
    const exponentialDelay = Math.min(
      this.initialDelayMs * this.backoffMultiplier ** attempt,
      this.maxDelayMs,
    );
    const jitterMs = Math.floor(
      Math.random() * Math.max(25, Math.floor(this.initialDelayMs / 2)),
    );

    return exponentialDelay + jitterMs;
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
