import type { AuthRepository } from "@/features/auth/auth.repository";
import type { BookingMessageEmailContent } from "@/features/bookings/messages/booking-messages.model";
import { MAX_BOOKING_MESSAGE_SNIPPET_LENGTH } from "@/features/bookings/messages/booking-messages.model";
import type { BookingMessagesRepository } from "@/features/bookings/messages/booking-messages.repository";

export interface ComposeBookingMessageEmailInput {
  bookingRequestId: string;
  recipientId: string;
  messageId: string;
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
    private readonly authRepository: AuthRepository,
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

    const recipient = await this.authRepository.findUserById(input.recipientId);

    if (!recipient?.email) {
      return null;
    }

    return {
      to: recipient.email,
      ...(recipient.firstName ? { firstName: recipient.firstName } : {}),
      postingName: message.bookingRequest.posting.name,
      authorName: this.resolveAuthorName(message.author),
      snippet: this.buildSnippet(message.body),
      bookingRequestId: message.bookingRequestId,
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
