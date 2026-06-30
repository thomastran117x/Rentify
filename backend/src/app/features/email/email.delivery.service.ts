import {
  getEnvironmentVariable,
  getOptionalEnvironmentVariable,
} from "@/configuration/environment";
import type { EmailJobPayload } from "@/features/email/email.model";
import type {
  SendLoginUnlockEmailInput,
  SendMfaStepUpEmailInput,
  SendNewDeviceEmailInput,
  SendOrganizationInviteEmailInput,
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
      case "mfa_step_up":
        await this.sendMfaStepUpEmail(payload.input);
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
      case "organization_invite":
        await this.sendOrganizationInviteEmail(payload.input);
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
        "Welcome to Rentify. Please verify your email address to finish setting up your account.",
        "",
        `Verification code: ${input.verificationCode}`,
        "",
        "This code expires in 15 minutes. If you did not create this account, you can safely ignore this email.",
      ].join("\n"),
      html: this.buildEmailHtml(
        [
          `<h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#020617;letter-spacing:-0.03em;">Verify your email address</h1>`,
          `<p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.7;">Hi ${escapedGreetingName},</p>`,
          `<p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.7;">Welcome to Rentify. Please verify your email address to finish setting up your account. Once verified, you&rsquo;ll have full access to browse listings, save searches, and manage your account.</p>`,
          this.buildCodeBlock("Verification code", escapedVerificationCode),
          `<p style="margin:8px 0 0;font-size:13px;color:#64748b;text-align:center;">This code expires in 15 minutes.</p>`,
          this.buildAlertBox(
            "Didn&rsquo;t create this account? You can safely ignore this email &mdash; no action is needed.",
            "info",
          ),
        ].join(""),
      ),
    });
  }

  async sendMfaStepUpEmail(input: SendMfaStepUpEmailInput): Promise<void> {
    const greetingName = this.resolveGreetingName(input.firstName);
    const escapedGreetingName = escapeHtml(greetingName);
    const escapedVerificationCode = escapeHtml(input.verificationCode);

    await this.sendWithRetry({
      to: input.to,
      subject: "Confirm your MFA security action",
      text: [
        `Hi ${greetingName},`,
        "",
        "Use this code to confirm the MFA-related change you just requested on your account.",
        "",
        `Verification code: ${input.verificationCode}`,
        "",
        "This code expires soon and only works for your current signed-in session.",
        "If you did not request this action, you should review your account security.",
      ].join("\n"),
      html: this.buildEmailHtml(
        [
          `<h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#020617;letter-spacing:-0.03em;">Confirm your security action</h1>`,
          `<p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.7;">Hi ${escapedGreetingName},</p>`,
          `<p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.7;">Use this code to confirm the MFA-related change you just requested on your account.</p>`,
          this.buildCodeBlock("Verification code", escapedVerificationCode),
          `<p style="margin:8px 0 0;font-size:13px;color:#64748b;text-align:center;">This code expires soon and only works for your current signed-in session.</p>`,
          this.buildAlertBox(
            "Didn&rsquo;t request this action? Your account security may be at risk &mdash; review your account security settings immediately.",
            "warning",
          ),
        ].join(""),
      ),
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
      .map(
        (detail, index) =>
          `<div style="padding:8px 0;${index < details.length - 1 ? "border-bottom:1px solid #f1f5f9;" : ""}font-size:13px;color:#334155;line-height:1.6;">${escapeHtml(detail)}</div>`,
      )
      .join("");
    const securityUrl = escapeHtml(`${this.appBaseUrl}/account/security`);

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
      html: this.buildEmailHtml(
        [
          `<h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#020617;letter-spacing:-0.03em;">New sign-in detected</h1>`,
          `<p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.7;">Hi ${escapeHtml(greetingName)},</p>`,
          `<p style="margin:0 0 4px;font-size:14px;color:#334155;line-height:1.7;">We noticed a sign-in from a new device on your account.</p>`,
          `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:8px 16px;margin:16px 0;">${htmlDetails}</div>`,
          `<p style="margin:0 0 0;font-size:14px;color:#334155;line-height:1.7;">If this was you, no action is needed.</p>`,
          this.buildAlertBox(
            `If this wasn&rsquo;t you, <strong>change your password and review account access immediately</strong>. <a href="${securityUrl}" style="color:#9f1239;font-weight:600;">Go to account security &rarr;</a>`,
            "warning",
          ),
        ].join(""),
      ),
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
      html: this.buildEmailHtml(
        [
          `<h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#020617;letter-spacing:-0.03em;">Your account was temporarily locked</h1>`,
          `<p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.7;">Hi ${escapedGreetingName},</p>`,
          `<p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.7;">We locked local sign-in after too many unsuccessful password attempts to protect your account. Use the code below to restore access.</p>`,
          this.buildCodeBlock("Unlock code", escapedUnlockCode),
          `<p style="margin:8px 0 0;font-size:14px;color:#334155;line-height:1.7;text-align:center;">Enter this code on the unlock screen to restore access.</p>`,
          this.buildAlertBox(
            "Not you? Someone may be attempting to access your account. Your account remains locked until the code is used &mdash; consider changing your password if you didn&rsquo;t trigger this.",
            "info",
          ),
        ].join(""),
      ),
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
        "This code expires in 15 minutes. If you didn't request this, you can ignore this email.",
      ].join("\n"),
      html: this.buildEmailHtml(
        [
          `<h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#020617;letter-spacing:-0.03em;">Reset your password</h1>`,
          `<p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.7;">Hi ${escapedGreetingName},</p>`,
          `<p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.7;">We received a request to reset the password for your Rentify account. Enter the code below to choose a new password.</p>`,
          this.buildCodeBlock("Reset code", escapedResetCode),
          `<p style="margin:8px 0 0;font-size:13px;color:#64748b;text-align:center;">This code expires in 15 minutes. Never share it with anyone.</p>`,
          this.buildAlertBox(
            "Didn&rsquo;t request a password reset? Your password won&rsquo;t change &mdash; you can safely ignore this email.",
            "info",
          ),
        ].join(""),
      ),
    });
  }

  async sendOrganizationInviteEmail(
    input: SendOrganizationInviteEmailInput,
  ): Promise<void> {
    const roleLabel = input.role.replaceAll("_", " ");
    const inviteUrl = `${this.appBaseUrl}/organizations/invitations/${encodeURIComponent(input.token)}`;
    const escapedOrganizationName = escapeHtml(input.organizationName);
    const escapedInviterName = escapeHtml(input.inviterName);
    const escapedRoleLabel = escapeHtml(roleLabel);
    const escapedInviteUrl = escapeHtml(inviteUrl);
    const escapedRoleLabelHtml = escapeHtml(this.formatRoleLabel(input.role));

    await this.sendWithRetry({
      to: input.to,
      subject: `Join ${input.organizationName} on Rent`,
      text: [
        "You have been invited to join an organization on Rent.",
        "",
        `Organization: ${input.organizationName}`,
        `Invited by: ${input.inviterName}`,
        `Role: ${roleLabel}`,
        "",
        `Open this invite to review and accept it: ${inviteUrl}`,
        "",
        "This invite expires in 7 days.",
      ].join("\n"),
      html: this.buildEmailHtml(
        [
          `<h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#020617;letter-spacing:-0.03em;">You&rsquo;ve been invited to join ${escapedOrganizationName}</h1>`,
          `<p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.7;">${escapedInviterName} has invited you to join an organization on Rentify as a <strong>${escapedRoleLabelHtml}</strong>.</p>`,
          `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:0 0 20px;">`,
          `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;line-height:1.6;"><span style="font-weight:600;color:#020617;min-width:100px;display:inline-block;">Organization</span>${escapedOrganizationName}</div>`,
          `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;line-height:1.6;"><span style="font-weight:600;color:#020617;min-width:100px;display:inline-block;">Invited by</span>${escapedInviterName}</div>`,
          `<div style="padding:8px 0;font-size:13px;color:#334155;line-height:1.6;"><span style="font-weight:600;color:#020617;min-width:100px;display:inline-block;">Role</span>${escapedRoleLabelHtml}</div>`,
          `</div>`,
          this.buildCTAButton(escapedInviteUrl, "Accept Invitation"),
          `<p style="margin:16px 0 0;font-size:13px;color:#64748b;text-align:center;">This invitation expires in 7 days. You can also <a href="${escapedInviteUrl}" style="color:#7c3aed;font-weight:600;">open the invite link directly</a>.</p>`,
        ].join(""),
      ),
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

  private buildEmailHtml(body: string): string {
    const year = new Date().getFullYear();
    return [
      `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>`,
      `<body style="margin:0;padding:0;background:#f8fafc;font-family:system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;padding:32px 16px;">`,
      `<tr><td align="center">`,
      `<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">`,
      `<tr><td align="center" style="padding:0 0 24px;">`,
      `<table cellpadding="0" cellspacing="0" border="0"><tr>`,
      `<td style="background:#7c3aed;border-radius:10px;width:36px;height:36px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:0.08em;line-height:36px;display:block;">R</span></td>`,
      `<td style="padding-left:10px;vertical-align:middle;"><span style="font-size:18px;font-weight:600;color:#020617;letter-spacing:-0.02em;">Rentify</span></td>`,
      `</tr></table>`,
      `</td></tr>`,
      `<tr><td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(2,6,23,0.04);">`,
      body,
      `</td></tr>`,
      `<tr><td align="center" style="padding:24px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">`,
      `<p style="margin:0;">&copy; ${year} Rentify &middot; This email was triggered by your account activity.</p>`,
      `</td></tr>`,
      `</table>`,
      `</td></tr></table>`,
      `</body></html>`,
    ].join("");
  }

  private buildCodeBlock(label: string, code: string): string {
    return [
      `<div style="background:#faf5ff;border:1px solid #ddd6fe;border-radius:12px;padding:24px 20px;text-align:center;margin:20px 0;">`,
      `<p style="margin:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:#7c3aed;">${label}</p>`,
      `<p style="margin:0;font-size:32px;font-weight:700;letter-spacing:0.35em;color:#020617;">${code}</p>`,
      `</div>`,
    ].join("");
  }

  private buildAlertBox(
    message: string,
    variant: "warning" | "info",
  ): string {
    const styles =
      variant === "warning"
        ? { bg: "#fff1f2", border: "#fecdd3", text: "#9f1239" }
        : { bg: "#f0f9ff", border: "#bae6fd", text: "#0369a1" };
    return [
      `<div style="background:${styles.bg};border:1px solid ${styles.border};border-radius:10px;padding:14px 16px;margin-top:20px;">`,
      `<p style="margin:0;font-size:13px;color:${styles.text};line-height:1.6;">${message}</p>`,
      `</div>`,
    ].join("");
  }

  private buildCTAButton(href: string, label: string): string {
    return [
      `<div style="text-align:center;margin:24px 0;">`,
      `<a href="${href}" style="display:inline-block;background:#7c3aed;color:#ffffff;font-size:14px;font-weight:600;padding:13px 28px;border-radius:10px;text-decoration:none;letter-spacing:-0.01em;box-shadow:0 1px 2px rgba(124,58,237,0.2);">${label}</a>`,
      `</div>`,
    ].join("");
  }

  private formatRoleLabel(role: string): string {
    return role
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
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
