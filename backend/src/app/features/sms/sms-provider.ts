import type {
  SendSmsMessageInput,
  SmsParsedWebhookEvent,
  SmsProviderErrorInfo,
  SmsProviderSendResult,
  SmsWebhookHeaders,
  SmsWebhookVerificationResult,
} from "@/features/sms/sms.model";

export interface SmsProviderAdapter {
  sendMessage(input: SendSmsMessageInput): Promise<SmsProviderSendResult>;
  verifyWebhookSignature(
    rawBody: string,
    headers: SmsWebhookHeaders,
  ): SmsWebhookVerificationResult;
  parseWebhookEvent(rawBody: string): SmsParsedWebhookEvent;
  classifyError(error: unknown): SmsProviderErrorInfo;
}