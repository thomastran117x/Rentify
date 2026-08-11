import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import type { AuthRepository } from "@/features/auth/auth.repository";
import type { BookingParticipantSide } from "@/features/bookings/booking-participants";
import type { BookingsRepository } from "@/features/bookings/bookings.repository";
import {
  BOOKING_MESSAGE_PRESENCE_TTL_SECONDS,
  BOOKING_MESSAGE_TYPING_TTL_SECONDS,
  type BookingMessageStreamEvent,
} from "@/features/bookings/messages/booking-messages.model";
import { bookingMessageChannel } from "@/features/bookings/messages/booking-message-stream.hub";
import type { CacheService } from "@/features/cache/cache.service";

/**
 * Ephemeral thread state: who is typing and who is currently watching.
 *
 * Nothing here is persisted. Both signals are keyed in Redis with a TTL so a
 * process that dies without running teardown cannot strand a user as
 * permanently "typing" or permanently "online".
 */
export class BookingMessagePresenceService {
  private readonly logger: Logger;

  constructor(
    private readonly cacheService: CacheService,
    private readonly bookingsRepository: BookingsRepository,
    private readonly authRepository: AuthRepository,
  ) {
    this.logger = loggerFactory.forClass(
      BookingMessagePresenceService,
      "service",
    );
  }

  async publishTyping(bookingRequestId: string, userId: string): Promise<void> {
    const actor = await this.describeActor(bookingRequestId, userId);

    if (!actor) {
      return;
    }

    const expiresAt = new Date(
      Date.now() + BOOKING_MESSAGE_TYPING_TTL_SECONDS * 1_000,
    ).toISOString();

    await this.publish({
      type: "typing",
      bookingRequestId,
      side: actor.side,
      username: actor.username,
      expiresAt,
    });
  }

  /**
   * Records that a socket for this side has connected.
   *
   * Counted rather than flagged, and keyed by side rather than by user, because
   * that is the question the other party is actually asking: is anyone from the
   * organization watching. A per-user boolean could not answer it without
   * enumerating the organization's members, and a per-process socket tally
   * could not answer it at all once the API runs more than one replica — each
   * replica only sees its own sockets, so the last one to lose a manager would
   * announce the whole side offline while a colleague sat connected to another.
   *
   * `INCR` returning 1 is the atomic "first one in" test, so only a genuine
   * transition is announced.
   */
  async join(
    bookingRequestId: string,
    side: BookingParticipantSide,
  ): Promise<void> {
    const key = this.presenceKey(bookingRequestId, side);
    const count = await this.cacheService.increment(key, 1);
    await this.cacheService.expire(key, BOOKING_MESSAGE_PRESENCE_TTL_SECONDS);

    if (count === 1) {
      await this.publishPresence(bookingRequestId, side, "online");
    }
  }

  /**
   * Records that a socket for this side has gone. The side only goes offline
   * when the last of them leaves, wherever it was connected.
   */
  async leave(
    bookingRequestId: string,
    side: BookingParticipantSide,
  ): Promise<void> {
    const key = this.presenceKey(bookingRequestId, side);
    const count = await this.cacheService.increment(key, -1);

    if (count > 0) {
      await this.cacheService.expire(key, BOOKING_MESSAGE_PRESENCE_TTL_SECONDS);
      return;
    }

    // At or below zero: nobody is left. Below zero means a process died without
    // decrementing and its share expired, so the key is removed rather than
    // left holding a negative that would swallow the next join's announcement.
    await this.cacheService.delete(key);
    await this.publishPresence(bookingRequestId, side, "offline");
  }

  /**
   * Pushes the TTL out for a side that still has sockets. Separate from `join`
   * so a refresh cannot be mistaken for an arrival and inflate the count.
   */
  async refresh(
    bookingRequestId: string,
    side: BookingParticipantSide,
  ): Promise<void> {
    await this.cacheService.expire(
      this.presenceKey(bookingRequestId, side),
      BOOKING_MESSAGE_PRESENCE_TTL_SECONDS,
    );
  }

  /** Whether anyone on this side is currently watching, across all replicas. */
  async isSideOnline(
    bookingRequestId: string,
    side: BookingParticipantSide,
  ): Promise<boolean> {
    const raw = await this.cacheService.get(
      this.presenceKey(bookingRequestId, side),
    );

    return raw !== null && Number(raw) > 0;
  }

  /**
   * The side is passed in rather than derived from the user, because the
   * transition belongs to the side: the user who happened to trip it is only
   * useful for a label. That label is deliberately omitted — with several
   * managers behind one presence signal, naming whichever one arrived first
   * would tell the renter which colleague is at their desk.
   */
  private async publishPresence(
    bookingRequestId: string,
    side: BookingParticipantSide,
    state: "online" | "offline",
  ): Promise<void> {
    const bookingRequest =
      await this.bookingsRepository.findById(bookingRequestId);

    if (!bookingRequest) {
      return;
    }

    await this.publish({
      type: "presence",
      bookingRequestId,
      side,
      state,
    });
  }

  private async describeActor(
    bookingRequestId: string,
    userId: string,
  ): Promise<{ side: BookingParticipantSide; username: string } | null> {
    const bookingRequest =
      await this.bookingsRepository.findById(bookingRequestId);

    if (!bookingRequest) {
      return null;
    }

    const user = await this.authRepository.findUserById(userId);

    return {
      // Derived rather than resolved through the participant helper: presence
      // is already gated by the socket's own authorization.
      side: bookingRequest.renterId === userId ? "renter" : "owner",
      username: user?.profile?.username ?? "Someone",
    };
  }

  private async publish(event: BookingMessageStreamEvent): Promise<void> {
    try {
      await this.cacheService.publish(
        bookingMessageChannel(event.bookingRequestId),
        JSON.stringify(event),
      );
    } catch (error) {
      // Ephemeral signals are best-effort by definition; losing one must never
      // disturb the connection that produced it.
      this.logger.warn(
        "Failed to publish a booking message presence event.",
        { bookingRequestId: event.bookingRequestId, eventType: event.type },
        error,
      );
    }
  }

  private presenceKey(
    bookingRequestId: string,
    side: BookingParticipantSide,
  ): string {
    return `booking-messages:presence:${bookingRequestId}:${side}`;
  }
}
