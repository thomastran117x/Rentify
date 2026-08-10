import { z } from "zod";
import type { BookingParticipantSide } from "@/features/bookings/booking-participants";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "@/features/postings/postings.model";

export const MAX_BOOKING_MESSAGE_LENGTH = 2000;

/**
 * How long a notification email is suppressed for the same (thread, recipient)
 * pair after one is queued. A fast back-and-forth exchange should produce one
 * email, not one per message.
 */
export const BOOKING_MESSAGE_NOTIFY_COOLDOWN_SECONDS = 300;

export const MAX_BOOKING_MESSAGE_SNIPPET_LENGTH = 140;

// `.trim()` runs before the length checks, so a whitespace-only body is
// rejected and a 2000-character body with trailing spaces is accepted.
export const sendBookingMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Message body is required.")
    .max(
      MAX_BOOKING_MESSAGE_LENGTH,
      `Message body cannot exceed ${MAX_BOOKING_MESSAGE_LENGTH} characters.`,
    ),
});

export const listBookingMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export type SendBookingMessageBody = z.infer<typeof sendBookingMessageSchema>;
export type ListBookingMessagesQuery = z.infer<
  typeof listBookingMessagesQuerySchema
>;

export interface BookingMessageRecord {
  id: string;
  bookingRequestId: string;
  authorId: string;
  /**
   * Which side of the booking authored the message. Derived from the booking's
   * `renterId` in the repository mapper so clients can align the thread without
   * knowing who the renter is.
   */
  authorSide: BookingParticipantSide;
  body: string;
  createdAt: string;
  /**
   * When the recipient *side* read this message, or null while unread. See
   * `BookingMessagesService.markRead` for the exact rule.
   */
  readAt: string | null;
}

export interface BookingMessagesPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface BookingMessagesListResult {
  messages: BookingMessageRecord[];
  pagination: BookingMessagesPagination;
  /** Unread messages addressed to the requesting side, across the whole thread. */
  unreadCount: number;
  /**
   * Whether the requesting user may send and mark read. Authoritative: it is
   * resolved against the booking's organization, so a manager of several
   * organizations keeps write access on a booking owned by any of them.
   */
  canWrite: boolean;
}

export interface MarkBookingMessagesReadResult {
  bookingRequestId: string;
  markedCount: number;
  readAt: string;
}

export interface SendBookingMessageInput {
  bookingRequestId: string;
  authorId: string;
  body: string;
}

export interface ListBookingMessagesInput {
  bookingRequestId: string;
  actorUserId: string;
  page: number;
  pageSize: number;
}

export interface BookingMessageStreamAuthorization {
  bookingRequestId: string;
  side: BookingParticipantSide;
}

export type BookingMessageStreamEvent =
  | {
      type: "message.created";
      bookingRequestId: string;
      message: BookingMessageRecord;
    }
  | {
      type: "messages.read";
      bookingRequestId: string;
      readerSide: BookingParticipantSide;
      readAt: string;
      markedCount: number;
    };

export interface BookingMessageEmailContent {
  to: string;
  firstName?: string;
  postingName: string;
  authorName: string;
  snippet: string;
  bookingRequestId: string;
}
