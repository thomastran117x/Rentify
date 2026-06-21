import { loggerFactory, type Logger } from "@/configuration/logging";
import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import type {
  SendSmsMessageInput,
  SmsParsedWebhookEvent,
  SmsWebhookHeaders,
} from "@/features/sms/sms.model";
import type { SmsProviderAdapter } from "@/features/sms/sms-provider";
import type { SmsQueueService } from "@/features/sms/sms.queue.service";

export class SmsService {
  private readonly logger: Logger;

  constructor(
    private readonly smsQueueService: SmsQueueService,
    private readonly smsProvider: SmsProviderAdapter,
  ) {
    this.logger = loggerFactory.forClass(SmsService, "service");
  }

  async sendMessage(input: SendSmsMessageInput): Promise<void> {
    await this.smsQueueService.enqueueSmsJob("message", input);
  }

  async processWebhook(
    rawBody: string,
    headers: SmsWebhookHeaders,
  ): Promise<SmsParsedWebhookEvent> {
    const verification = this.smsProvider.verifyWebhookSignature(rawBody, headers);

    if (!verification.isValid) {
      this.logger.warn("SMS webhook signature verification failed.", {
        eventId: verification.eventId,
        eventType: verification.eventType,
        reason: verification.reason ?? "unknown",
      });
      throw new ForbiddenError("SMS webhook signature is invalid.", {
        eventId: verification.eventId,
        eventType: verification.eventType,
      });
    }

    try {
      const event = this.smsProvider.parseWebhookEvent(rawBody);
      this.logWebhookEvent(event);
      return event;
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      throw new BadRequestError("SMS webhook payload is invalid.");
    }
  }

  private logWebhookEvent(event: SmsParsedWebhookEvent): void {
    const fields = {
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      direction: event.direction,
      messageId: event.messageId,
      fromPhoneNumber: event.fromPhoneNumber,
      toPhoneNumbers: event.toPhoneNumbers,
      deliveryStatus: event.deliveryStatus,
      errorCodes: event.errors.map((item) => item.code).filter(Boolean),
    };

    if (
      event.deliveryStatus === "delivery_failed" ||
      event.deliveryStatus === "sending_failed"
    ) {
      this.logger.warn("SMS webhook reported a failed delivery state.", fields);
      return;
    }

    if (event.eventType === "unsupported") {
      this.logger.warn("SMS webhook used an unsupported event type.", fields);
      return;
    }

    this.logger.info("SMS webhook processed successfully.", fields);
  }
}