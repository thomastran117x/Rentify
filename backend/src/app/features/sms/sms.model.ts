export interface SendSmsMessageInput {
  to: string;
  text: string;
  metadata?: Record<string, unknown>;
  webhookContext?: {
    webhookUrl?: string;
    webhookFailoverUrl?: string;
  };
}

export type SmsJobKind = "message";

export type SmsJobInputByKind = {
  message: SendSmsMessageInput;
};

export type SmsJobPayload = {
  jobId: string;
  kind: "message";
  input: SendSmsMessageInput;
  attempt: number;
  occurredAt: string;
};

export interface SmsProviderSendResult {
  providerMessageId?: string;
  providerStatus?: string;
  costAmount?: number;
  costCurrency?: string;
  raw: Record<string, unknown>;
}

export interface SmsProviderErrorInfo {
  category: "transient" | "permanent" | "unknown";
  code?: string;
  message: string;
  retryable: boolean;
}

export interface SmsWebhookHeaders {
  signatureEd25519?: string;
  timestamp?: string;
}

export interface SmsWebhookVerificationResult {
  isValid: boolean;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  reason?: string;
}

export type SmsWebhookEventType =
  | "message.received"
  | "message.sent"
  | "message.finalized"
  | "unsupported";

export interface SmsWebhookErrorDetail {
  code?: string;
  title?: string;
  detail?: string;
}

export interface SmsParsedWebhookEvent {
  eventId: string;
  eventType: SmsWebhookEventType;
  occurredAt?: string;
  direction?: "inbound" | "outbound";
  messageId?: string;
  fromPhoneNumber?: string;
  toPhoneNumbers: string[];
  deliveryStatus?: string;
  payload: Record<string, unknown>;
  errors: SmsWebhookErrorDetail[];
}
