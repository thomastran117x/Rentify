import { z } from "zod";
import type { BookingParticipantSide } from "@/features/bookings/booking-participants";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "@/features/postings/postings.model";
import type { Uuid } from "@/configuration/validation/uuid";

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
 * A browser cannot set an `Authorization` header on the Socket.IO handshake, so
 * the client exchanges its bearer token for a short-lived single-use ticket over
 * REST. The ticket comes back as an HttpOnly cookie scoped to the socket path,
 * which keeps it out of URLs, proxy logs and page scripts; the short life bounds
 * what a leaked one is worth.
 */
export const BOOKING_MESSAGE_SOCKET_TICKET_TTL_SECONDS = 30;

/** Path the client upgrades on, and the cookie's scope. */
export const BOOKING_MESSAGE_SOCKET_PATH = "/ws/booking-messages";

/** HttpOnly cookie carrying the upgrade ticket, scoped to the socket path. */
export const BOOKING_MESSAGE_SOCKET_COOKIE_NAME = "rentify_ws_ticket";

/** How long a typing indicator stands before it expires on its own. */
export const BOOKING_MESSAGE_TYPING_TTL_SECONDS = 6;

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
  id: Uuid;
  bookingRequestId: Uuid;
  authorId: Uuid;
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
  bookingRequestId: Uuid;
  markedCount: number;
  readAt: string;
}

export interface SendBookingMessageInput {
  bookingRequestId: Uuid;
  authorId: Uuid;
  body: string;
}

export interface EditBookingMessageInput {
  bookingRequestId: Uuid;
  messageId: Uuid;
  actorUserId: Uuid;
  body: string;
}

export interface DeleteBookingMessageInput {
  bookingRequestId: Uuid;
  messageId: Uuid;
  actorUserId: Uuid;
}

export interface ListBookingMessagesInput {
  bookingRequestId: Uuid;
  actorUserId: Uuid;
  page: number;
  pageSize: number;
}

export interface BookingMessageStreamAuthorization {
  bookingRequestId: Uuid;
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
  bookingRequestId: Uuid;
  userId: Uuid;
  sessionId: string | null;
  tokenVersion: number | null;
}

export type BookingMessageStreamEvent =
  | {
      type: "message.created";
      bookingRequestId: Uuid;
      message: BookingMessageRecord;
    }
  | {
      type: "message.updated";
      bookingRequestId: Uuid;
      message: BookingMessageRecord;
    }
  | {
      type: "messages.read";
      bookingRequestId: Uuid;
      readerSide: BookingParticipantSide;
      readAt: string;
      markedCount: number;
    }
  | {
      type: "messages.delivered";
      bookingRequestId: Uuid;
      messageIds: Uuid[];
      deliveredAt: string;
    }
  | {
      // Ephemeral: never persisted, and expires on its own if the sender goes
      // quiet or their socket drops.
      type: "typing";
      bookingRequestId: Uuid;
      side: BookingParticipantSide;
      username: string;
      expiresAt: string;
    }
  | {
      /**
       * Tells a client its own capabilities may have changed and it should
       * refetch the thread. Sent to the affected socket only, and deliberately
       * carries no values: the thread response is already the single source for
       * `canWrite` and the viewer's side, so one event covers all of it.
       */
      type: "resync";
      bookingRequestId: Uuid;
    }
  | {
      type: "presence";
      bookingRequestId: Uuid;
      /**
       * Presence belongs to the side, not to a person. An organization is
       * present when any of its managers is watching, and naming whichever one
       * tripped the transition would tell the renter which colleague is at
       * their desk — so no username is carried here, unlike `typing`, where the
       * actor is the whole point.
       */
      side: BookingParticipantSide;
      state: "online" | "offline";
    };

export interface BookingMessageEmailContent {
  to: string;
  firstName?: string;
  postingName: string;
  authorName: string;
  snippet: string;
  bookingRequestId: Uuid;
}
