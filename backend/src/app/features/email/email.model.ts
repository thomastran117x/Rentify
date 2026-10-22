import type {
  SendAccountStatusEmailInput,
  SendBookingMessageNotificationEmailInput,
  SendEmailChangeCodeEmailInput,
  SendEmailChangeNoticeEmailInput,
  SendLoginUnlockEmailInput,
  SendMfaStepUpEmailInput,
  SendNewDeviceEmailInput,
  SendOrganizationInviteEmailInput,
  SendPasswordResetEmailInput,
  SendPostingExpiringSoonEmailInput,
  SendSavedSearchMatchesEmailInput,
  SendUsernameReminderEmailInput,
  SendVerificationEmailInput,
} from "@/features/email/email.service";

export type EmailJobKind =
  | "verification"
  | "email_change_code"
  | "email_change_notice"
  | "mfa_step_up"
  | "new_device"
  | "login_unlock"
  | "password_reset"
  | "username_reminder"
  | "organization_invite"
  | "booking_message"
  | "posting_expiring_soon"
  | "saved_search_matches"
  | "account_locked"
  | "account_suspended"
  | "account_reinstated";

export type EmailJobInputByKind = {
  verification: SendVerificationEmailInput;
  email_change_code: SendEmailChangeCodeEmailInput;
  email_change_notice: SendEmailChangeNoticeEmailInput;
  mfa_step_up: SendMfaStepUpEmailInput;
  new_device: SendNewDeviceEmailInput;
  login_unlock: SendLoginUnlockEmailInput;
  password_reset: SendPasswordResetEmailInput;
  username_reminder: SendUsernameReminderEmailInput;
  organization_invite: SendOrganizationInviteEmailInput;
  booking_message: SendBookingMessageNotificationEmailInput;
  posting_expiring_soon: SendPostingExpiringSoonEmailInput;
  saved_search_matches: SendSavedSearchMatchesEmailInput;
  account_locked: SendAccountStatusEmailInput;
  account_suspended: SendAccountStatusEmailInput;
  account_reinstated: SendAccountStatusEmailInput;
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
      kind: "email_change_code";
      input: SendEmailChangeCodeEmailInput;
      attempt: number;
      occurredAt: string;
    }
  | {
      jobId: string;
      kind: "email_change_notice";
      input: SendEmailChangeNoticeEmailInput;
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
    }
  | {
      jobId: string;
      kind: "saved_search_matches";
      input: SendSavedSearchMatchesEmailInput;
      attempt: number;
      occurredAt: string;
    }
  | {
      jobId: string;
      kind: "account_locked" | "account_suspended" | "account_reinstated";
      input: SendAccountStatusEmailInput;
      attempt: number;
      occurredAt: string;
    };
