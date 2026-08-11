import { randomBytes } from "node:crypto";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import type { BookingParticipantSide } from "@/features/bookings/booking-participants";
import {
  resolveBookingParticipant,
  resolveBookingParticipantAccess,
} from "@/features/bookings/booking-participants";
import type { BookingRequestRecord } from "@/features/bookings/bookings.model";
import type { BookingsRepository } from "@/features/bookings/bookings.repository";
import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import type {
  BookingMessageRecord,
  BookingMessageSocketIdentity,
  BookingMessageSocketSession,
  BookingMessageSocketTicket,
  DeleteBookingMessageInput,
  EditBookingMessageInput,
  BookingMessageStreamAuthorization,
  BookingMessageStreamEvent,
  BookingMessagesListResult,
  ListBookingMessagesInput,
  MarkBookingMessagesReadResult,
  SendBookingMessageInput,
} from "@/features/bookings/messages/booking-messages.model";
import {
  BOOKING_MESSAGE_EDIT_WINDOW_MS,
  BOOKING_MESSAGE_NOTIFY_COOLDOWN_SECONDS,
  BOOKING_MESSAGE_SOCKET_TICKET_TTL_SECONDS,
} from "@/features/bookings/messages/booking-messages.model";
import { bookingMessageChannel } from "@/features/bookings/messages/booking-message-stream.hub";
import type { BookingMessagesRepository } from "@/features/bookings/messages/booking-messages.repository";
import type { CacheService } from "@/features/cache/cache.service";
import type { EmailService } from "@/features/email/email.service";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { OrganizationsRepository } from "@/features/organizations/organizations.repository";
import type { TokenService } from "@/features/auth/token/token.service";

export class BookingMessagesService {
  private readonly logger: Logger;

  constructor(
    private readonly bookingMessagesRepository: BookingMessagesRepository,
    private readonly bookingsRepository: BookingsRepository,
    private readonly organizationAccessService: OrganizationAccessService,
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly cacheService: CacheService,
    private readonly emailService: EmailService,
    private readonly tokenService: TokenService,
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
    // Resolved rather than asserted: a read-only member is allowed here, and
    // the resulting capability is what the client uses to decide whether to
    // offer a composer.
    const { side, canManage } = await resolveBookingParticipantAccess(
      this.organizationAccessService,
      bookingRequest,
      input.actorUserId,
    );

    const [page, unreadCount, parties] = await Promise.all([
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
      this.bookingMessagesRepository.findThreadParties(bookingRequest.id),
    ]);

    return {
      messages: page.messages,
      pagination: page.pagination,
      unreadCount,
      canWrite: canManage,
      viewerSide: side,
      // Each side is told who the *other* party is: the renter talks to the
      // organization, and the organization talks to a named renter.
      counterpartName:
        side === "renter"
          ? (parties?.organizationName ?? "the organization")
          : (parties?.renterUsername ?? "the renter"),
    };
  }

  async edit(input: EditBookingMessageInput): Promise<BookingMessageRecord> {
    const { bookingRequest, message } = await this.requireOwnEditableMessage(
      input.bookingRequestId,
      input.messageId,
      input.actorUserId,
    );

    const updated = await this.bookingMessagesRepository.updateBodyIfEligible({
      messageId: message.id,
      authorId: input.actorUserId,
      body: input.body,
      editedAt: new Date(),
      notBefore: this.editWindowStart(),
      renterId: bookingRequest.renterId,
    });

    if (!updated) {
      // Lost a race with a concurrent delete or the window closing.
      throw new BadRequestError("This message can no longer be changed.");
    }

    await this.publishEvent({
      type: "message.updated",
      bookingRequestId: bookingRequest.id,
      message: updated,
    });

    return updated;
  }

  async remove(
    input: DeleteBookingMessageInput,
  ): Promise<BookingMessageRecord> {
    const { bookingRequest, message } = await this.requireOwnEditableMessage(
      input.bookingRequestId,
      input.messageId,
      input.actorUserId,
    );

    const deleted = await this.bookingMessagesRepository.softDeleteIfEligible({
      messageId: message.id,
      authorId: input.actorUserId,
      deletedAt: new Date(),
      notBefore: this.editWindowStart(),
      renterId: bookingRequest.renterId,
    });

    if (!deleted) {
      throw new BadRequestError("This message can no longer be changed.");
    }

    await this.publishEvent({
      type: "message.updated",
      bookingRequestId: bookingRequest.id,
      message: deleted,
    });

    return deleted;
  }

  /**
   * Only the author may change their own message, and only inside the edit
   * window. Read state deliberately does not gate this: a fixed window is
   * predictable, whereas locking on read would surprise the sender.
   */
  private editWindowStart(): Date {
    return new Date(Date.now() - BOOKING_MESSAGE_EDIT_WINDOW_MS);
  }

  private async requireOwnEditableMessage(
    bookingRequestId: string,
    messageId: string,
    actorUserId: string,
  ): Promise<{
    bookingRequest: BookingRequestRecord;
    message: BookingMessageRecord;
  }> {
    const bookingRequest = await this.requireBookingRequest(bookingRequestId);
    await resolveBookingParticipant(
      this.organizationAccessService,
      bookingRequest,
      actorUserId,
      "manage",
    );

    const message = await this.bookingMessagesRepository.findById(
      messageId,
      bookingRequest.renterId,
    );

    if (!message || message.bookingRequestId !== bookingRequest.id) {
      throw new ResourceNotFoundError("Message could not be found.");
    }

    if (message.authorId !== actorUserId) {
      throw new ForbiddenError("You can only change your own messages.");
    }

    if (message.deletedAt) {
      throw new BadRequestError("This message has already been deleted.");
    }

    const age = Date.now() - new Date(message.createdAt).getTime();

    if (age > BOOKING_MESSAGE_EDIT_WINDOW_MS) {
      throw new BadRequestError(
        "Messages can only be changed within 15 minutes of sending.",
      );
    }

    return { bookingRequest, message };
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

  /**
   * Mints a single-use ticket for the socket upgrade. A browser `WebSocket`
   * cannot send an `Authorization` header, so the bearer token is exchanged
   * here and the ticket is presented on the upgrade instead.
   */
  async createSocketTicket(
    bookingRequestId: string,
    actorUserId: string,
    session: BookingMessageSocketSession = {},
  ): Promise<BookingMessageSocketTicket> {
    // Same bar as reading the thread: a ticket must never widen access.
    await this.authorizeStream(bookingRequestId, actorUserId);

    const ticket = randomBytes(32).toString("base64url");

    // The session that minted the ticket rides along so the socket can be
    // re-checked against it later. Without this the connection outlives its own
    // session: membership is revalidated, but a signed-out user keeps
    // receiving messages.
    const identity: BookingMessageSocketIdentity = {
      bookingRequestId,
      userId: actorUserId,
      sessionId: session.sessionId ?? null,
      tokenVersion: session.tokenVersion ?? null,
    };

    await this.cacheService.setJson(
      this.socketTicketKey(ticket),
      identity,
      BOOKING_MESSAGE_SOCKET_TICKET_TTL_SECONDS,
    );

    return {
      ticket,
      expiresInSeconds: BOOKING_MESSAGE_SOCKET_TICKET_TTL_SECONDS,
    };
  }

  /**
   * Confirms the session behind an open socket is still usable. Called on the
   * reauthorization sweep, alongside the membership check.
   */
  async assertSocketSessionValid(
    identity: BookingMessageSocketIdentity,
  ): Promise<void> {
    await this.tokenService.assertSessionIsUsable(
      identity.userId,
      identity.sessionId,
      identity.tokenVersion,
    );
  }

  /**
   * Redeems a ticket exactly once. Deleting before use closes the window where
   * a ticket leaked from a proxy log or browser history could be replayed.
   */
  async redeemSocketTicket(
    ticket: string,
  ): Promise<BookingMessageSocketIdentity | null> {
    if (!ticket) {
      return null;
    }

    // Read and removed in one operation. Reading then deleting let two
    // concurrent upgrades both observe the ticket before either deleted it, so
    // both were admitted and the single-use guarantee held only when nothing
    // raced.
    const identity =
      await this.cacheService.getDeleteJson<BookingMessageSocketIdentity>(
        this.socketTicketKey(ticket),
      );

    if (!identity) {
      return null;
    }

    // Re-authorized rather than trusted: both membership and the session can
    // change between minting the ticket and the upgrade landing. Checking only
    // membership here left a signed-out user able to open a *new* socket inside
    // the ticket's 30-second window and hold it until the next sweep — the
    // periodic check closes a connection, it does not stop one being made.
    try {
      await this.authorizeStream(identity.bookingRequestId, identity.userId);
      await this.assertSocketSessionValid(identity);
    } catch {
      return null;
    }

    return identity;
  }

  private socketTicketKey(ticket: string): string {
    return `booking-messages:ws-ticket:${ticket}`;
  }

  /**
   * Records that a recipient's client received these messages. Delivery is
   * weaker than read: it only says the bytes arrived, which can happen while
   * the thread sits unopened in another tab.
   */
  async markDelivered(
    bookingRequestId: string,
    actorUserId: string,
    messageIds: string[],
  ): Promise<string[]> {
    const bookingRequest = await this.requireBookingRequest(bookingRequestId);
    // Read access is enough: acknowledging receipt is not a write to the
    // conversation, and a read-only member still receives the messages.
    const { side } = await resolveBookingParticipantAccess(
      this.organizationAccessService,
      bookingRequest,
      actorUserId,
    );

    const deliveredAt = new Date();
    const delivered = await this.bookingMessagesRepository.markDeliveredForSide(
      {
        bookingRequestId: bookingRequest.id,
        renterId: bookingRequest.renterId,
        side,
        messageIds,
        deliveredAt,
      },
    );

    if (delivered.length === 0) {
      return [];
    }

    await this.publishEvent({
      type: "messages.delivered",
      bookingRequestId: bookingRequest.id,
      messageIds: delivered,
      deliveredAt: deliveredAt.toISOString(),
    });

    return delivered;
  }

  async authorizeStream(
    bookingRequestId: string,
    actorUserId: string,
  ): Promise<BookingMessageStreamAuthorization> {
    const bookingRequest = await this.requireBookingRequest(bookingRequestId);
    // Resolved rather than asserted, for the same reason `list` does it: a
    // read-only member may connect, and the caller needs to know they cannot
    // write. Non-participants are still rejected.
    const { side, canManage } = await resolveBookingParticipantAccess(
      this.organizationAccessService,
      bookingRequest,
      actorUserId,
    );

    return { bookingRequestId: bookingRequest.id, side, canWrite: canManage };
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

      const cooldownKey = this.notifyCooldownKey(
        bookingRequest.id,
        recipientId,
      );
      const claimed = await this.cacheService.setIfNotExists(
        cooldownKey,
        "1",
        BOOKING_MESSAGE_NOTIFY_COOLDOWN_SECONDS,
      );

      if (!claimed) {
        return;
      }

      try {
        await this.emailService.sendBookingMessageNotificationEmail({
          bookingRequestId: bookingRequest.id,
          recipientId,
          messageId: record.id,
        });
      } catch (error) {
        // Release the claim: keeping it would let one transient broker failure
        // silently mute every notification for this pair for the full window.
        await this.cacheService.delete(cooldownKey).catch(() => undefined);
        throw error;
      }
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
