import type {
  SendBookingMessageNotificationEmailInput,
  SendLoginUnlockEmailInput,
  SendMfaStepUpEmailInput,
  SendNewDeviceEmailInput,
  SendOrganizationInviteEmailInput,
  SendPasswordResetEmailInput,
  SendPostingExpiringSoonEmailInput,
  SendUsernameReminderEmailInput,
  SendVerificationEmailInput,
} from "@/features/email/email.service";

export type EmailJobKind =
  | "verification"
  | "mfa_step_up"
  | "new_device"
  | "login_unlock"
  | "password_reset"
  | "username_reminder"
  | "organization_invite"
  | "booking_message"
  | "posting_expiring_soon";

export type EmailJobInputByKind = {
  verification: SendVerificationEmailInput;
  mfa_step_up: SendMfaStepUpEmailInput;
  new_device: SendNewDeviceEmailInput;
  login_unlock: SendLoginUnlockEmailInput;
  password_reset: SendPasswordResetEmailInput;
  username_reminder: SendUsernameReminderEmailInput;
  organization_invite: SendOrganizationInviteEmailInput;
  booking_message: SendBookingMessageNotificationEmailInput;
  posting_expiring_soon: SendPostingExpiringSoonEmailInput;
};

export type EmailJobPayload =
  | {
      jobId: string;
      kind: "verification";
      input: SendVerificationEmailInput;
      attempt: number;
      occurredAt: string;
    }
  | {
      jobId: string;
      kind: "mfa_step_up";
      input: SendMfaStepUpEmailInput;
      attempt: number;
      occurredAt: string;
    }
  | {
      jobId: string;
      kind: "new_device";
      input: SendNewDeviceEmailInput;
      attempt: number;
      occurredAt: string;
    }
  | {
      jobId: string;
      kind: "login_unlock";
      input: SendLoginUnlockEmailInput;
      attempt: number;
      occurredAt: string;
    }
  | {
      jobId: string;
      kind: "password_reset";
      input: SendPasswordResetEmailInput;
      attempt: number;
      occurredAt: string;
    }
  | {
      jobId: string;
      kind: "username_reminder";
      input: SendUsernameReminderEmailInput;
      attempt: number;
      occurredAt: string;
    }
  | {
      jobId: string;
      kind: "organization_invite";
      input: SendOrganizationInviteEmailInput;
      attempt: number;
      occurredAt: string;
    }
  | {
      jobId: string;
      kind: "booking_message";
      input: SendBookingMessageNotificationEmailInput;
      attempt: number;
      occurredAt: string;
    }
  | {
      jobId: string;
      kind: "posting_expiring_soon";
      input: SendPostingExpiringSoonEmailInput;
      attempt: number;
      occurredAt: string;
    };
