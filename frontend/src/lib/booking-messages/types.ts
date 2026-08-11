import type { Pagination } from "@/lib/api/types";

/** Which side of the booking authored a message. */
export type BookingMessageAuthorSide = "renter" | "owner";

export const MAX_BOOKING_MESSAGE_LENGTH = 2000;

export interface BookingMessageRecord {
  id: string;
  bookingRequestId: string;
  authorId: string;
  authorSide: BookingMessageAuthorSide;
  body: string;
  createdAt: string;
  /** When the recipient side read this message, or null while unread. */
  readAt: string | null;
}

export interface BookingMessagesListResult {
  messages: BookingMessageRecord[];
  pagination: Pagination;
  /** Unread messages addressed to the requesting side, across the whole thread. */
  unreadCount: number;
  /**
   * Whether this viewer may send and mark read, resolved by the API against
   * the booking's organization. Authoritative — do not re-derive it from the
   * session's active organization, which is wrong for a manager who belongs to
   * several organizations.
   */
  canWrite: boolean;
  /**
   * Which side of the thread this viewer is on. Align the conversation against
   * this rather than the author's user id: a second organization manager must
   * see a colleague's message as outgoing, not as the renter's.
   */
  viewerSide: BookingMessageAuthorSide;
}

export interface MarkBookingMessagesReadResult {
  bookingRequestId: string;
  markedCount: number;
  readAt: string;
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
      readerSide: BookingMessageAuthorSide;
      readAt: string;
      markedCount: number;
    };

export type BookingMessageStreamStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "failed";
