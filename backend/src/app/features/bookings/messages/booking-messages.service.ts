import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import type { BookingParticipantSide } from "@/features/bookings/booking-participants";
import { resolveBookingParticipant } from "@/features/bookings/booking-participants";
import type { BookingRequestRecord } from "@/features/bookings/bookings.model";
import type { BookingsRepository } from "@/features/bookings/bookings.repository";
import type {
  BookingMessageRecord,
  BookingMessageStreamAuthorization,
  BookingMessageStreamEvent,
  BookingMessagesListResult,
  ListBookingMessagesInput,
  MarkBookingMessagesReadResult,
  SendBookingMessageInput,
} from "@/features/bookings/messages/booking-messages.model";
import { BOOKING_MESSAGE_NOTIFY_COOLDOWN_SECONDS } from "@/features/bookings/messages/booking-messages.model";
import { bookingMessageChannel } from "@/features/bookings/messages/booking-message-stream.hub";
import type { BookingMessagesRepository } from "@/features/bookings/messages/booking-messages.repository";
import type { CacheService } from "@/features/cache/cache.service";
import type { EmailService } from "@/features/email/email.service";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { OrganizationsRepository } from "@/features/organizations/organizations.repository";

export class BookingMessagesService {
  private readonly logger: Logger;

  constructor(
    private readonly bookingMessagesRepository: BookingMessagesRepository,
    private readonly bookingsRepository: BookingsRepository,
    private readonly organizationAccessService: OrganizationAccessService,
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly cacheService: CacheService,
    private readonly emailService: EmailService,
  ) {
    this.logger = loggerFactory.forClass(BookingMessagesService, "service");
  }

  async send(input: SendBookingMessageInput): Promise<BookingMessageRecord> {
    const bookingRequest = await this.requireBookingRequest(
      input.bookingRequestId,
    );
    const side = await resolveBookingParticipant(
      this.organizationAccessService,
      bookingRequest,
      input.authorId,
      "manage",
    );

    const record = await this.bookingMessagesRepository.create({
      bookingRequestId: bookingRequest.id,
      authorId: input.authorId,
      body: input.body,
      renterId: bookingRequest.renterId,
    });

    // Fan-out and notification are best-effort. The message is already durably
    // persisted, so a Redis blip or a RabbitMQ hiccup must not turn a delivered
    // message into a 500 that makes the user send it twice. This is the one
    // place we deliberately swallow rather than let errors bubble to the
    // application error handler.
    await this.publishCreated(record);
    await this.notifyOtherParty(bookingRequest, record, side);

    return record;
  }

  async list(
    input: ListBookingMessagesInput,
  ): Promise<BookingMessagesListResult> {
    const bookingRequest = await this.requireBookingRequest(
      input.bookingRequestId,
    );
    const side = await resolveBookingParticipant(
      this.organizationAccessService,
      bookingRequest,
      input.actorUserId,
      "read",
    );

    const [page, unreadCount] = await Promise.all([
      this.bookingMessagesRepository.listByBookingRequest({
        bookingRequestId: bookingRequest.id,
        renterId: bookingRequest.renterId,
        page: input.page,
        pageSize: input.pageSize,
      }),
      this.bookingMessagesRepository.countUnreadForSide({
        bookingRequestId: bookingRequest.id,
        renterId: bookingRequest.renterId,
        side,
      }),
    ]);

    return {
      messages: page.messages,
      pagination: page.pagination,
      unreadCount,
    };
  }

  async markRead(
    bookingRequestId: string,
    actorUserId: string,
  ): Promise<MarkBookingMessagesReadResult> {
    const bookingRequest = await this.requireBookingRequest(bookingRequestId);
    const side = await resolveBookingParticipant(
      this.organizationAccessService,
      bookingRequest,
      actorUserId,
      "manage",
    );

    const readAt = new Date();
    const markedCount = await this.bookingMessagesRepository.markReadForSide({
      bookingRequestId: bookingRequest.id,
      renterId: bookingRequest.renterId,
      side,
      readAt,
    });

    const result: MarkBookingMessagesReadResult = {
      bookingRequestId: bookingRequest.id,
      markedCount,
      readAt: readAt.toISOString(),
    };

    if (markedCount > 0) {
      await this.publishEvent({
        type: "messages.read",
        bookingRequestId: bookingRequest.id,
        readerSide: side,
        readAt: result.readAt,
        markedCount,
      });
    }

    return result;
  }

  async authorizeStream(
    bookingRequestId: string,
    actorUserId: string,
  ): Promise<BookingMessageStreamAuthorization> {
    const bookingRequest = await this.requireBookingRequest(bookingRequestId);
    const side = await resolveBookingParticipant(
      this.organizationAccessService,
      bookingRequest,
      actorUserId,
      "read",
    );

    return { bookingRequestId: bookingRequest.id, side };
  }

  private async requireBookingRequest(
    bookingRequestId: string,
  ): Promise<BookingRequestRecord> {
    const bookingRequest =
      await this.bookingsRepository.findById(bookingRequestId);

    if (!bookingRequest) {
      throw new ResourceNotFoundError("Booking request could not be found.");
    }

    return bookingRequest;
  }

  private async publishCreated(record: BookingMessageRecord): Promise<void> {
    await this.publishEvent({
      type: "message.created",
      bookingRequestId: record.bookingRequestId,
      message: record,
    });
  }

  private async publishEvent(event: BookingMessageStreamEvent): Promise<void> {
    try {
      await this.cacheService.publish(
        bookingMessageChannel(event.bookingRequestId),
        JSON.stringify(event),
      );
    } catch (error) {
      this.logger.error(
        "Failed to publish booking message event.",
        {
          bookingRequestId: event.bookingRequestId,
          eventType: event.type,
        },
        error,
      );
    }
  }

  private async notifyOtherParty(
    bookingRequest: BookingRequestRecord,
    record: BookingMessageRecord,
    authorSide: BookingParticipantSide,
  ): Promise<void> {
    try {
      const recipientId =
        authorSide === "renter"
          ? await this.organizationsRepository.findPrimaryManagerUserId(
              bookingRequest.organizationId,
            )
          : bookingRequest.renterId;

      // No primary manager (orphaned organization), or the author is also the
      // recipient — a primary manager can be the renter on someone else's
      // posting, and a user must never be emailed about their own message.
      if (!recipientId || recipientId === record.authorId) {
        return;
      }

      const claimed = await this.cacheService.setIfNotExists(
        this.notifyCooldownKey(bookingRequest.id, recipientId),
        "1",
        BOOKING_MESSAGE_NOTIFY_COOLDOWN_SECONDS,
      );

      if (!claimed) {
        return;
      }

      await this.emailService.sendBookingMessageNotificationEmail({
        bookingRequestId: bookingRequest.id,
        recipientId,
        messageId: record.id,
      });
    } catch (error) {
      this.logger.error(
        "Failed to queue booking message notification.",
        {
          bookingRequestId: bookingRequest.id,
          messageId: record.id,
        },
        error,
      );
    }
  }

  private notifyCooldownKey(
    bookingRequestId: string,
    recipientId: string,
  ): string {
    return `booking-messages:notify:${bookingRequestId}:${recipientId}`;
  }
}
