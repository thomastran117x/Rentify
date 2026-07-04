import type {
  SendLoginUnlockEmailInput,
  SendMfaStepUpEmailInput,
  SendNewDeviceEmailInput,
  SendOrganizationInviteEmailInput,
  SendPasswordResetEmailInput,
  SendSavedSearchAlertEmailInput,
  SendVerificationEmailInput,
} from "@/features/email/email.service";

export type EmailJobKind =
  | "verification"
  | "mfa_step_up"
  | "new_device"
  | "login_unlock"
  | "password_reset"
  | "organization_invite"
  | "saved_search_alert";

export type EmailJobInputByKind = {
  verification: SendVerificationEmailInput;
  mfa_step_up: SendMfaStepUpEmailInput;
  new_device: SendNewDeviceEmailInput;
  login_unlock: SendLoginUnlockEmailInput;
  password_reset: SendPasswordResetEmailInput;
  organization_invite: SendOrganizationInviteEmailInput;
  saved_search_alert: SendSavedSearchAlertEmailInput;
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
      kind: "organization_invite";
      input: SendOrganizationInviteEmailInput;
      attempt: number;
      occurredAt: string;
    }
  | {
      jobId: string;
      kind: "saved_search_alert";
      input: SendSavedSearchAlertEmailInput;
      attempt: number;
      occurredAt: string;
    };
