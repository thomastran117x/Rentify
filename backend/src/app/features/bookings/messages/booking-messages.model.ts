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

/**
 * How long an author may edit or delete their own message. A fixed window is
 * predictable for the sender and bounds how far the booking record can be
 * rewritten after the fact, regardless of whether the other side has read it.
 */
export const BOOKING_MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * A browser `WebSocket` cannot send an `Authorization` header, so the client
 * exchanges its bearer token for a short-lived single-use ticket over REST and
 * presents that on the upgrade. Kept brief because it necessarily travels in
 * the query string, where proxies and access logs can see it.
 */
export const BOOKING_MESSAGE_SOCKET_TICKET_TTL_SECONDS = 30;

/** Path the client upgrades on, and the cookie's scope. */
export const BOOKING_MESSAGE_SOCKET_PATH = "/ws/booking-messages";

/** HttpOnly cookie carrying the upgrade ticket, scoped to the socket path. */
export const BOOKING_MESSAGE_SOCKET_COOKIE_NAME = "rentify_ws_ticket";

/** How long a typing indicator stands before it expires on its own. */
export const BOOKING_MESSAGE_TYPING_TTL_SECONDS = 6;

/** Presence keys are refreshed by heartbeat and expire if a socket vanishes. */
export const BOOKING_MESSAGE_PRESENCE_TTL_SECONDS = 45;

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

export const editBookingMessageSchema = sendBookingMessageSchema;

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
export type EditBookingMessageBody = z.infer<typeof editBookingMessageSchema>;
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
  /** The author's username, so a thread with several managers stays legible. */
  authorUsername: string;
  /** Empty once deleted — the tombstone is the record, not the text. */
  body: string;
  createdAt: string;
  /**
   * When the recipient *side* read this message, or null while unread. See
   * `BookingMessagesService.markRead` for the exact rule.
   */
  readAt: string | null;
  /** When the recipient's client acknowledged receipt, distinct from readAt. */
  deliveredAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
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
  /** Who the requesting user is talking to, so the thread names its parties. */
  counterpartName: string;
  /**
   * Which side of the thread the requesting user is on. Clients align the
   * conversation against this rather than against the author's user id, so a
   * second organization manager sees a colleague's message as outgoing.
   */
  viewerSide: BookingParticipantSide;
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

export interface EditBookingMessageInput {
  bookingRequestId: string;
  messageId: string;
  actorUserId: string;
  body: string;
}

export interface DeleteBookingMessageInput {
  bookingRequestId: string;
  messageId: string;
  actorUserId: string;
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
  /**
   * Whether this participant may write to the thread. Connecting only needs
   * read access — an organization operator can watch a thread they may not
   * post to — so the capability has to travel separately from the permission
   * to be here at all.
   */
  canWrite: boolean;
}

export interface BookingMessageSocketTicket {
  /** Never returned to the browser: it is delivered as an HttpOnly cookie. */
  ticket: string;
  expiresInSeconds: number;
}

/**
 * Who a redeemed ticket belongs to, and which session minted it.
 *
 * The session fields are what let a long-lived socket be re-checked against
 * logout and token-version bumps. They are not a credential — they identify a
 * session so it can be looked up, and the ticket they travel in is single-use
 * and short-lived.
 */
/** The session details a ticket carries, taken from the minting request. */
export interface BookingMessageSocketSession {
  sessionId?: string | null;
  tokenVersion?: number | null;
}

export interface BookingMessageSocketIdentity {
  bookingRequestId: string;
  userId: string;
  sessionId: string | null;
  tokenVersion: number | null;
}

/** Frames the client may send once connected. */
export type BookingMessageClientFrame =
  | { type: "typing" }
  | { type: "delivered"; messageIds: string[] }
  | { type: "ping" };

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
      readerSide: BookingParticipantSide;
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
      // Ephemeral: never persisted, and expires on its own if the sender goes
      // quiet or their socket drops.
      type: "typing";
      bookingRequestId: string;
      side: BookingParticipantSide;
      username: string;
      expiresAt: string;
    }
  | {
      type: "presence";
      bookingRequestId: string;
      side: BookingParticipantSide;
      username: string;
      state: "online" | "offline";
    };

export interface BookingMessageEmailContent {
  to: string;
  firstName?: string;
  postingName: string;
  authorName: string;
  snippet: string;
  bookingRequestId: string;
}
