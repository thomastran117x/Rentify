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
   * Registers one socket's presence lease for this side.
   *
   * A sorted set of leases rather than a counter, and keyed by side rather than
   * by user, for three separate reasons that all point the same way:
   *
   * - The question the other party asks is "is anyone from the organization
   *   watching", which a per-user key cannot answer without enumerating the
   *   organization's members.
   * - A tally of one process's sockets cannot answer it either once the API is
   *   replicated: each replica sees only its own, so the last one to lose a
   *   manager would announce the side offline while a colleague sat connected
   *   elsewhere.
   * - A shared *counter* fixes that but cannot expire a dead replica's share.
   *   Any surviving socket refreshing the key renews everyone's contribution,
   *   including contributions from processes that have since died, so the count
   *   never reaches zero and the side is never announced offline again. Each
   *   socket holding its own independently expiring lease is what makes a crash
   *   self-correcting.
   */
  async join(
    bookingRequestId: string,
    side: BookingParticipantSide,
    socketId: string,
  ): Promise<void> {
    const key = this.presenceKey(bookingRequestId, side);
    await this.cacheService.addToLeaseSet(key, socketId, this.leaseExpiry());
    await this.cacheService.expire(key, BOOKING_MESSAGE_PRESENCE_TTL_SECONDS);

    // Counted after the write, so a join and a departure racing each other can
    // only both conclude "someone is here" — never both conclude "nobody is".
    const live = await this.cacheService.countLiveLeases(key, Date.now());

    if (live === 1) {
      await this.publishPresence(bookingRequestId, side, "online");
    }
  }

  /**
   * Drops one socket's lease. The side goes offline only when no live lease is
   * left anywhere.
   */
  async leave(
    bookingRequestId: string,
    side: BookingParticipantSide,
    socketId: string,
  ): Promise<void> {
    const key = this.presenceKey(bookingRequestId, side);
    await this.cacheService.removeFromLeaseSet(key, socketId);

    // Removal and the count are separate round trips, so a socket joining in
    // between is possible. Counting *after* removing is what makes that safe:
    // the newcomer's lease is already in the set, this reads a non-zero count
    // and stays quiet, and its own join announced the arrival. The reverse
    // order would delete a live socket's presence and publish offline over the
    // top of an online it had just sent.
    const live = await this.cacheService.countLiveLeases(key, Date.now());

    if (live > 0) {
      return;
    }

    await this.cacheService.delete(key);
    await this.publishPresence(bookingRequestId, side, "offline");
  }

  /**
   * Renews this socket's own lease. Only its own: renewing the whole key would
   * carry dead replicas' leases along with it, which is the failure this shape
   * exists to avoid.
   */
  async refresh(
    bookingRequestId: string,
    side: BookingParticipantSide,
    socketId: string,
  ): Promise<void> {
    const key = this.presenceKey(bookingRequestId, side);
    await this.cacheService.addToLeaseSet(key, socketId, this.leaseExpiry());
    await this.cacheService.expire(key, BOOKING_MESSAGE_PRESENCE_TTL_SECONDS);
  }

  /** Whether anyone on this side is watching, across every replica. */
  async isSideOnline(
    bookingRequestId: string,
    side: BookingParticipantSide,
  ): Promise<boolean> {
    const live = await this.cacheService.countLiveLeases(
      this.presenceKey(bookingRequestId, side),
      Date.now(),
    );

    return live > 0;
  }

  private leaseExpiry(): number {
    return Date.now() + BOOKING_MESSAGE_PRESENCE_TTL_SECONDS * 1_000;
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
