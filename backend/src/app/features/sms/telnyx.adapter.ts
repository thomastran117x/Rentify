import {
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";
import { getEnvironment } from "@/configuration/environment";
import BadRequestError from "@/errors/http/bad-request.error";
import type {
  SendSmsMessageInput,
  SmsParsedWebhookEvent,
  SmsProviderErrorInfo,
  SmsProviderSendResult,
  SmsWebhookErrorDetail,
  SmsWebhookHeaders,
  SmsWebhookVerificationResult,
} from "@/features/sms/sms.model";
import type { SmsProviderAdapter } from "@/features/sms/sms-provider";

interface TelnyxSmsAdapterOptions {
  apiKey?: string;
  fromNumber?: string;
  publicKey?: string;
  messagingProfileId?: string;
  webhookPublicUrl?: string;
  requestTimeoutMs?: number;
  timestampToleranceMs?: number;
}

const TELNYX_API_BASE_URL = "https://api.telnyx.com/v2";
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1_000;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIndexable(value: unknown): value is Record<string, unknown> | unknown[] {
  return isPlainObject(value) || Array.isArray(value);
}

function readNestedRecord(
  input: Record<string, unknown>,
  path: string[],
): Record<string, unknown> | undefined {
  let current: unknown = input;

  for (const segment of path) {
    if (!isIndexable(current) || !(segment in current)) {
      return undefined;
    }

    current = current[segment as keyof typeof current];
  }

  return isPlainObject(current) ? current : undefined;
}

function readNestedString(
  input: Record<string, unknown>,
  path: string[],
): string | undefined {
  let current: unknown = input;

  for (const segment of path) {
    if (!isIndexable(current) || !(segment in current)) {
      return undefined;
    }

    current = current[segment as keyof typeof current];
  }

  return typeof current === "string" ? current : undefined;
}

function readNestedNumber(
  input: Record<string, unknown>,
  path: string[],
): number | undefined {
  let current: unknown = input;

  for (const segment of path) {
    if (!isIndexable(current) || !(segment in current)) {
      return undefined;
    }

    current = current[segment as keyof typeof current];
  }

  return typeof current === "number" ? current : undefined;
}

function readNestedArray(
  input: Record<string, unknown>,
  path: string[],
): unknown[] | undefined {
  let current: unknown = input;

  for (const segment of path) {
    if (!isIndexable(current) || !(segment in current)) {
      return undefined;
    }

    current = current[segment as keyof typeof current];
  }

  return Array.isArray(current) ? current : undefined;
}

function normalizeEventType(eventType: string): SmsParsedWebhookEvent["eventType"] {
  switch (eventType) {
    case "message.received":
    case "message.sent":
    case "message.finalized":
      return eventType;
    default:
      return "unsupported";
  }
}

export class TelnyxSmsAdapter implements SmsProviderAdapter {
  private readonly apiKey: string;
  private readonly fromNumber: string;
  private readonly publicKey: string;
  private readonly messagingProfileId?: string;
  private readonly webhookPublicUrl?: string;
  private readonly requestTimeoutMs: number;
  private readonly timestampToleranceMs: number;
  private readonly publicKeyObject: KeyObject;

  constructor(options: TelnyxSmsAdapterOptions = {}) {
    const environment = getEnvironment();
    this.apiKey = options.apiKey ?? environment.sms.telnyx.apiKey ?? "";
    this.fromNumber = options.fromNumber ?? environment.sms.fromNumber ?? "";
    this.publicKey = options.publicKey ?? environment.sms.telnyx.publicKey ?? "";
    this.messagingProfileId =
      options.messagingProfileId ?? environment.sms.telnyx.messagingProfileId ?? undefined;
    this.webhookPublicUrl =
      options.webhookPublicUrl ?? environment.sms.webhookPublicUrl ?? undefined;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.timestampToleranceMs =
      options.timestampToleranceMs ?? DEFAULT_TIMESTAMP_TOLERANCE_MS;
    this.publicKeyObject = this.createVerificationKey(this.publicKey);
  }

  async sendMessage(input: SendSmsMessageInput): Promise<SmsProviderSendResult> {
    const webhookUrl =
      input.webhookContext?.webhookUrl ?? this.webhookPublicUrl ?? undefined;
    const payload: Record<string, unknown> = {
      from: this.fromNumber,
      to: input.to,
      text: input.text,
    };

    if (this.messagingProfileId) {
      payload.messaging_profile_id = this.messagingProfileId;
    }

    if (webhookUrl) {
      payload.webhook_url = webhookUrl;
    }

    if (input.webhookContext?.webhookFailoverUrl) {
      payload.webhook_failover_url = input.webhookContext.webhookFailoverUrl;
    }

    const tags = this.readTags(input.metadata);
    if (tags.length > 0) {
      payload.tags = tags;
    }

    const response = await this.requestJson("/messages", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
    });

    return {
      providerMessageId: readNestedString(response.body, ["data", "id"]),
      providerStatus: readNestedString(response.body, ["data", "to", "0", "status"]),
      costAmount: readNestedNumber(response.body, ["data", "cost", "amount"]),
      costCurrency: readNestedString(response.body, ["data", "cost", "currency"]),
      raw: response.body,
    };
  }

  verifyWebhookSignature(
    rawBody: string,
    headers: SmsWebhookHeaders,
  ): SmsWebhookVerificationResult {
    const payload = this.parseJsonRecord(rawBody);
    const eventId = readNestedString(payload, ["data", "id"]) ?? "unknown";
    const eventType = readNestedString(payload, ["data", "event_type"]) ?? "unknown";
    const signatureHeader = headers.signatureEd25519;
    const timestampHeader = headers.timestamp;

    if (!signatureHeader) {
      return {
        isValid: false,
        eventId,
        eventType,
        payload,
        reason: "missing-signature",
      };
    }

    if (!timestampHeader) {
      return {
        isValid: false,
        eventId,
        eventType,
        payload,
        reason: "missing-timestamp",
      };
    }

    const timestampSeconds = Number(timestampHeader);
    if (!Number.isFinite(timestampSeconds)) {
      return {
        isValid: false,
        eventId,
        eventType,
        payload,
        reason: "invalid-timestamp",
      };
    }

    const ageMs = Math.abs(Date.now() - timestampSeconds * 1_000);
    if (ageMs > this.timestampToleranceMs) {
      return {
        isValid: false,
        eventId,
        eventType,
        payload,
        reason: "stale-timestamp",
      };
    }

    let signature: Buffer;
    try {
      signature = Buffer.from(signatureHeader, "base64");
    } catch {
      return {
        isValid: false,
        eventId,
        eventType,
        payload,
        reason: "invalid-signature-encoding",
      };
    }

    const signedPayload = Buffer.from(`${timestampHeader}|${rawBody}`, "utf8");
    const isValid = verifySignature(
      null,
      signedPayload,
      this.publicKeyObject,
      signature,
    );

    return {
      isValid,
      eventId,
      eventType,
      payload,
      reason: isValid ? undefined : "signature-mismatch",
    };
  }

  parseWebhookEvent(rawBody: string): SmsParsedWebhookEvent {
    const payload = this.parseJsonRecord(rawBody);
    const data = readNestedRecord(payload, ["data"]);
    const messagePayload = readNestedRecord(payload, ["data", "payload"]);
    const eventId = readNestedString(payload, ["data", "id"]);
    const eventType = readNestedString(payload, ["data", "event_type"]);

    if (!data || !messagePayload || !eventId || !eventType) {
      throw new BadRequestError("SMS webhook payload is invalid.");
    }

    return {
      eventId,
      eventType: normalizeEventType(eventType),
      occurredAt: readNestedString(payload, ["data", "occurred_at"]),
      direction: this.readDirection(messagePayload),
      messageId: readNestedString(payload, ["data", "payload", "id"]),
      fromPhoneNumber: readNestedString(payload, ["data", "payload", "from", "phone_number"]),
      toPhoneNumbers: this.readPhoneNumbers(messagePayload),
      deliveryStatus: this.readFirstToStatus(messagePayload),
      payload,
      errors: this.readErrors(messagePayload),
    };
  }

  classifyError(error: unknown): SmsProviderErrorInfo {
    const message = error instanceof Error ? error.message : "Telnyx request failed.";
    const codeValue =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    const code = typeof codeValue === "string" ? codeValue : undefined;

    if (code === "ETIMEDOUT" || code === "ABORT_ERR") {
      return {
        category: "unknown",
        code,
        message,
        retryable: false,
      };
    }

    if (typeof error === "object" && error !== null && "status" in error) {
      const status = (error as { status?: unknown }).status;

      if (typeof status === "number") {
        if (status === 429 || status >= 500) {
          return {
            category: "transient",
            code,
            message,
            retryable: true,
          };
        }

        if (status >= 400) {
          return {
            category: "permanent",
            code,
            message,
            retryable: false,
          };
        }
      }
    }

    const transientCodes = new Set([
      "ECONNRESET",
      "ECONNREFUSED",
      "EPIPE",
      "PROVIDER_NETWORK_ERROR",
    ]);

    return {
      category: code && transientCodes.has(code) ? "transient" : "unknown",
      code,
      message,
      retryable: true,
    };
  }

  private async requestJson(
    path: string,
    init: RequestInit,
  ): Promise<{ body: Record<string, unknown> }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;

    try {
      response = await fetch(`${TELNYX_API_BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw this.toTelnyxTransportError(error);
    } finally {
      clearTimeout(timeoutId);
    }

    const text = await response.text();
    const body = this.parseResponseBody(text, response.status);

    if (!response.ok) {
      const apiError = this.readApiError(body);
      const error = new Error(
        apiError?.detail ?? `Telnyx request failed with ${response.status}.`,
      ) as Error & {
        status?: number;
        code?: string;
      };
      error.status = response.status;
      error.code = apiError?.code;
      throw error;
    }

    return { body };
  }

  private parseResponseBody(text: string, status: number): Record<string, unknown> {
    if (text.length === 0) {
      return {};
    }

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      const error = new Error(
        "Telnyx returned an invalid JSON response.",
      ) as Error & {
        status?: number;
        code?: string;
      };
      error.status = status;
      error.code = "INVALID_PROVIDER_RESPONSE";
      throw error;
    }
  }

  private parseJsonRecord(rawBody: string): Record<string, unknown> {
    try {
      const payload = JSON.parse(rawBody) as unknown;
      if (!isPlainObject(payload)) {
        throw new Error("Payload is not an object.");
      }

      return payload;
    } catch {
      throw new BadRequestError("SMS webhook payload is invalid.");
    }
  }

  private createVerificationKey(value: string): KeyObject {
    const trimmed = value.trim();

    if (trimmed.includes("BEGIN PUBLIC KEY")) {
      return createPublicKey(trimmed);
    }

    const rawKey = this.decodeRawPublicKey(trimmed);
    return createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
      format: "der",
      type: "spki",
    });
  }

  private decodeRawPublicKey(value: string): Buffer {
    if (/^[0-9a-f]{64}$/i.test(value)) {
      return Buffer.from(value, "hex");
    }

    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 32) {
      throw new Error(
        "TELNYX_PUBLIC_KEY must be PEM, base64, or hex-encoded Ed25519 public key material.",
      );
    }

    return decoded;
  }

  private toTelnyxTransportError(error: unknown): Error & { status?: number; code?: string } {
    const mapped = new Error(
      this.isAbortError(error)
        ? "Telnyx request timed out."
        : "Telnyx request failed before receiving a response.",
    ) as Error & {
      status?: number;
      code?: string;
    };

    mapped.status = this.isAbortError(error) ? 504 : 503;
    mapped.code = this.isAbortError(error)
      ? "ETIMEDOUT"
      : this.readNodeErrorCode(error) ?? "PROVIDER_NETWORK_ERROR";
    return mapped;
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }

  private readNodeErrorCode(error: unknown): string | undefined {
    const directCode =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (typeof directCode === "string") {
      return directCode;
    }

    if (typeof error !== "object" || error === null || !("cause" in error)) {
      return undefined;
    }

    const cause = (error as { cause?: unknown }).cause;

    if (typeof cause !== "object" || cause === null || !("code" in cause)) {
      return undefined;
    }

    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }

  private readTags(metadata?: Record<string, unknown>): string[] {
    if (!metadata) {
      return [];
    }

    const tags = metadata.tags;
    if (!Array.isArray(tags)) {
      return [];
    }

    return tags.filter((item): item is string => typeof item === "string");
  }

  private readApiError(
    body: Record<string, unknown>,
  ): { code?: string; detail?: string } | undefined {
    const errors = body.errors;
    if (!Array.isArray(errors) || errors.length === 0 || !isPlainObject(errors[0])) {
      return undefined;
    }

    return {
      code: typeof errors[0].code === "string" ? errors[0].code : undefined,
      detail: typeof errors[0].detail === "string" ? errors[0].detail : undefined,
    };
  }

  private readDirection(
    payload: Record<string, unknown>,
  ): "inbound" | "outbound" | undefined {
    const direction = readNestedString(payload, ["direction"]);
    return direction === "inbound" || direction === "outbound" ? direction : undefined;
  }

  private readPhoneNumbers(payload: Record<string, unknown>): string[] {
    const recipients = readNestedArray(payload, ["to"]);
    if (!recipients) {
      return [];
    }

    return recipients
      .map((item) => (isPlainObject(item) ? item.phone_number : undefined))
      .filter((item): item is string => typeof item === "string");
  }

  private readFirstToStatus(payload: Record<string, unknown>): string | undefined {
    const recipients = readNestedArray(payload, ["to"]);
    if (!recipients || recipients.length === 0) {
      return undefined;
    }

    const first = recipients[0];
    return isPlainObject(first) && typeof first.status === "string" ? first.status : undefined;
  }

  private readErrors(payload: Record<string, unknown>): SmsWebhookErrorDetail[] {
    const errors = readNestedArray(payload, ["errors"]);
    if (!errors) {
      return [];
    }

    return errors.filter(isPlainObject).map((item) => ({
      code: typeof item.code === "string" ? item.code : undefined,
      title: typeof item.title === "string" ? item.title : undefined,
      detail: typeof item.detail === "string" ? item.detail : undefined,
    }));
  }
}

