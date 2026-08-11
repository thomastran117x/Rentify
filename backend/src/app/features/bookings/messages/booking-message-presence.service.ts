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

  async markOnline(bookingRequestId: string, userId: string): Promise<void> {
    const key = this.presenceKey(bookingRequestId, userId);
    // `setIfNotExists` doubles as the "was already online" test, so a heartbeat
    // refresh does not re-announce a user who never left.
    const isNewlyOnline = await this.cacheService.setIfNotExists(
      key,
      "1",
      BOOKING_MESSAGE_PRESENCE_TTL_SECONDS,
    );

    if (!isNewlyOnline) {
      await this.cacheService.expire(key, BOOKING_MESSAGE_PRESENCE_TTL_SECONDS);
      return;
    }

    await this.publishPresence(bookingRequestId, userId, "online");
  }

  async markOffline(
    bookingRequestId: string,
    userId: string,
    options: { announce?: boolean } = {},
  ): Promise<void> {
    await this.cacheService.delete(this.presenceKey(bookingRequestId, userId));

    // The key is per user, but the announcement is per side: the other party
    // sees "the organization is here", not which manager. When a colleague on
    // the same side is still connected the caller suppresses the announcement
    // while this user's own key is still cleared.
    if (options.announce === false) {
      return;
    }

    // Otherwise published whether or not the key was still there. Keying the
    // announcement off the delete result meant a key that expired between
    // refreshes swallowed the offline event and left the counterpart's dot lit
    // forever. The caller knows the transition happened; Redis does not.
    await this.publishPresence(bookingRequestId, userId, "offline");
  }

  async isOnline(bookingRequestId: string, userId: string): Promise<boolean> {
    return this.cacheService.exists(this.presenceKey(bookingRequestId, userId));
  }

  private async publishPresence(
    bookingRequestId: string,
    userId: string,
    state: "online" | "offline",
  ): Promise<void> {
    const actor = await this.describeActor(bookingRequestId, userId);

    if (!actor) {
      return;
    }

    await this.publish({
      type: "presence",
      bookingRequestId,
      side: actor.side,
      username: actor.username,
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

  private presenceKey(bookingRequestId: string, userId: string): string {
    return `booking-messages:presence:${bookingRequestId}:${userId}`;
  }
}
