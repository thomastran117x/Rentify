import type { Pagination } from "@/lib/api/types";

/** Which side of the booking authored a message. */
export type BookingMessageAuthorSide = "renter" | "owner";

export const MAX_BOOKING_MESSAGE_LENGTH = 2000;

export interface BookingMessageRecord {
  id: string;
  bookingRequestId: string;
  authorId: string;
  authorSide: BookingMessageAuthorSide;
  /** The author's username, so a thread with several managers stays legible. */
  authorUsername: string;
  /** Empty once deleted — the tombstone is the record, not the text. */
  body: string;
  createdAt: string;
  /** When the recipient side read this message, or null while unread. */
  readAt: string | null;
  /** When the recipient's client acknowledged receipt, distinct from readAt. */
  deliveredAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
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
  /** Who this viewer is talking to, for naming the conversation. */
  counterpartName: string;
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

export const BOOKING_MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

export type BookingMessageStreamEvent =
  | {
      type: "message.created";
      bookingRequestId: string;
      message: BookingMessageRecord;
    }
  | {
      type: "message.updated";
      bookingRequestId: string;
      message: BookingMessageRecord;
    }
  | {
      type: "messages.read";
      bookingRequestId: string;
      readerSide: BookingMessageAuthorSide;
      readAt: string;
      markedCount: number;
    }
  | {
      type: "messages.delivered";
      bookingRequestId: string;
      messageIds: string[];
      deliveredAt: string;
    }
  | {
      type: "typing";
      bookingRequestId: string;
      side: BookingMessageAuthorSide;
      username: string;
      expiresAt: string;
    }
  | {
      /** The server says this client's capabilities changed; refetch. */
      type: "resync";
      bookingRequestId: string;
    }
  | {
      type: "presence";
      bookingRequestId: string;
      /**
       * Presence belongs to the side rather than a person: an organization is
       * present when any of its managers is watching, so no username is
       * carried. `typing` names its actor because there the actor is the point.
       */
      side: BookingMessageAuthorSide;
      state: "online" | "offline";
    };

export type BookingMessageStreamStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "failed";
