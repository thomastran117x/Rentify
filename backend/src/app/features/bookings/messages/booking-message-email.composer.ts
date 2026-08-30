import type { UsersRepository } from "@/features/auth/users/users.repository";
import { resolveBookingParticipantAccess } from "@/features/bookings/booking-participants";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { BookingMessageEmailContent } from "@/features/bookings/messages/booking-messages.model";
import { MAX_BOOKING_MESSAGE_SNIPPET_LENGTH } from "@/features/bookings/messages/booking-messages.model";
import type { BookingMessagesRepository } from "@/features/bookings/messages/booking-messages.repository";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";

export interface ComposeBookingMessageEmailInput {
  bookingRequestId: Uuid;
  recipientId: Uuid;
  messageId: Uuid;
}

/**
 * Hydrates a booking message notification email from the ids carried on the
 * queue job.
 *
 * Returns `null` whenever the underlying records no longer exist so the worker
 * acknowledges the job instead of retrying it to the dead-letter queue — a
 * notification for a deleted booking or user is not worth redelivering.
 */
export class BookingMessageEmailComposer {
  constructor(
    private readonly bookingMessagesRepository: BookingMessagesRepository,
    private readonly usersRepository: UsersRepository,
    private readonly organizationAccessService: OrganizationAccessService,
  ) {}

  async compose(
    input: ComposeBookingMessageEmailInput,
  ): Promise<BookingMessageEmailContent | null> {
    const message = await this.bookingMessagesRepository.findByIdWithContext(
      input.messageId,
    );

    if (!message || message.bookingRequestId !== input.bookingRequestId) {
      return null;
    }

    // A soft delete clears the body but keeps the row, so a job that waited
    // behind a backlog while the author deleted their message would otherwise
    // send a "new message" email with an empty snippet. Returning null makes
    // the worker acknowledge without sending, which is what it does for a
    // message that has gone entirely.
    if (message.deletedAt) {
      return null;
    }

    // Re-checked at send time, not trusted from the job. The recipient was the
    // organization's primary manager when the message was written; by the time
    // the worker runs they may have been removed or replaced, and this email
    // carries a snippet of a private conversation. Membership is the gate for
    // reading the thread, so it has to be the gate for being told about it.
    try {
      await resolveBookingParticipantAccess(
        this.organizationAccessService,
        {
          ...message.bookingRequest,
          organizationId: asUuid(message.bookingRequest.organizationId),
          renterId: asUuid(message.bookingRequest.renterId),
        },
        input.recipientId,
      );
    } catch {
      return null;
    }

    const recipient = await this.usersRepository.findUserById(
      input.recipientId,
    );

    if (!recipient?.email) {
      return null;
    }

    return {
      to: recipient.email,
      ...(recipient.firstName ? { firstName: recipient.firstName } : {}),
      postingName: message.bookingRequest.posting.name,
      authorName: this.resolveAuthorName(message.author),
      snippet: this.buildSnippet(message.body),
      bookingRequestId: asUuid(message.bookingRequestId),
    };
  }

  private resolveAuthorName(author: {
    firstName: string | null;
    lastName: string | null;
  }): string {
    const name = [author.firstName, author.lastName]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(" ")
      .trim();

    return name || "Someone";
  }

  private buildSnippet(body: string): string {
    if (body.length <= MAX_BOOKING_MESSAGE_SNIPPET_LENGTH) {
      return body;
    }

    return `${body.slice(0, MAX_BOOKING_MESSAGE_SNIPPET_LENGTH).trimEnd()}…`;
  }
}
