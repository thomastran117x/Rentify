import { randomUUID } from "node:crypto";
import { loggerFactory, type Logger } from "@/configuration/logging";
import BadRequestError from "@/errors/http/bad-request.error";
import type {
  SendSmsMessageInput,
  SmsParsedWebhookEvent,
  SmsProviderErrorInfo,
  SmsProviderSendResult,
  SmsWebhookHeaders,
  SmsWebhookVerificationResult,
} from "@/features/sms/sms.model";
import type { SmsProviderAdapter } from "@/features/sms/sms-provider";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class NoopSmsAdapter implements SmsProviderAdapter {
  private readonly logger: Logger;

  constructor() {
    this.logger = loggerFactory.forClass(NoopSmsAdapter, "service");
  }

  async sendMessage(input: SendSmsMessageInput): Promise<SmsProviderSendResult> {
    const providerMessageId = `noop-sms-${randomUUID()}`;

    this.logger.info("SMS delivery skipped by noop adapter.", {
      providerMessageId,
      to: input.to,
      textLength: input.text.length,
      metadata: input.metadata,
      webhookContext: input.webhookContext,
    });

    return {
      providerMessageId,
      providerStatus: "noop",
      raw: {
        provider: "noop",
        to: input.to,
        text: input.text,
        metadata: input.metadata,
        webhookContext: input.webhookContext,
      },
    };
  }

  verifyWebhookSignature(
    rawBody: string,
    _headers: SmsWebhookHeaders,
  ): SmsWebhookVerificationResult {
    const payload = this.tryParsePayload(rawBody);
    return {
      isValid: true,
      eventId: this.readString(payload, ["data", "id"]) ?? "noop-event",
      eventType:
        this.readString(payload, ["data", "event_type"]) ?? "unsupported",
      payload,
      reason: "noop-provider",
    };
  }

  parseWebhookEvent(rawBody: string): SmsParsedWebhookEvent {
    const payload = this.tryParsePayload(rawBody);
    const data = this.readRecord(payload, ["data"]);
    const messagePayload = this.readRecord(payload, ["data", "payload"]);

    if (!data || !messagePayload) {
      throw new BadRequestError("SMS webhook payload is invalid.");
    }

    return {
      eventId: this.readString(payload, ["data", "id"]) ?? "noop-event",
      eventType: "unsupported",
      occurredAt: this.readString(payload, ["data", "occurred_at"]),
      direction: this.readDirection(messagePayload),
      messageId: this.readString(payload, ["data", "payload", "id"]),
      fromPhoneNumber: this.readString(payload, ["data", "payload", "from", "phone_number"]),
      toPhoneNumbers: this.readPhoneNumbers(messagePayload),
      deliveryStatus: this.readFirstToStatus(messagePayload),
      payload,
      errors: [],
    };
  }

  classifyError(error: unknown): SmsProviderErrorInfo {
    return {
      category: "unknown",
      message: error instanceof Error ? error.message : "SMS delivery failed.",
      retryable: true,
    };
  }

  private tryParsePayload(rawBody: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private readRecord(
    input: Record<string, unknown>,
    path: string[],
  ): Record<string, unknown> | undefined {
    let current: unknown = input;

    for (const segment of path) {
      if (!isPlainObject(current) || !(segment in current)) {
        return undefined;
      }

      current = current[segment];
    }

    return isPlainObject(current) ? current : undefined;
  }

  private readString(
    input: Record<string, unknown>,
    path: string[],
  ): string | undefined {
    let current: unknown = input;

    for (const segment of path) {
      if (!isPlainObject(current) || !(segment in current)) {
        return undefined;
      }

      current = current[segment];
    }

    return typeof current === "string" ? current : undefined;
  }

  private readDirection(
    payload: Record<string, unknown>,
  ): "inbound" | "outbound" | undefined {
    const direction = this.readString(payload, ["direction"]);
    return direction === "inbound" || direction === "outbound"
      ? direction
      : undefined;
  }

  private readPhoneNumbers(payload: Record<string, unknown>): string[] {
    const recipients = payload.to;

    if (!Array.isArray(recipients)) {
      return [];
    }

    return recipients
      .map((item) => (isPlainObject(item) ? item.phone_number : undefined))
      .filter((item): item is string => typeof item === "string");
  }

  private readFirstToStatus(payload: Record<string, unknown>): string | undefined {
    const recipients = payload.to;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return undefined;
    }

    const first = recipients[0];
    return isPlainObject(first) && typeof first.status === "string"
      ? first.status
      : undefined;
  }
}
