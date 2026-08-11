import type { AuthRepository } from "@/features/auth/auth.repository";
import type { BookingsRepository } from "@/features/bookings/bookings.repository";
import { BookingMessagePresenceService } from "@/features/bookings/messages/booking-message-presence.service";
import {
  BOOKING_MESSAGE_PRESENCE_TTL_SECONDS,
  BOOKING_MESSAGE_TYPING_TTL_SECONDS,
} from "@/features/bookings/messages/booking-messages.model";
import type { CacheService } from "@/features/cache/cache.service";

const BOOKING_ID = "booking-1";
const RENTER_ID = "renter-1";
const CHANNEL = `booking-messages:${BOOKING_ID}`;

function createService(
  options: {
    bookingRequest?: unknown;
    username?: string;
    /** What INCR/DECR returns: the count *after* this call. */
    count?: number;
    /** What a raw read of the key returns. */
    storedCount?: string | null;
  } = {},
) {
  const cacheService = {
    publish: jest.fn(async () => 1),
    increment: jest.fn(async () => options.count ?? 1),
    expire: jest.fn(async () => true),
    delete: jest.fn(async () => true),
    exists: jest.fn(async () => true),
    get: jest.fn(async () =>
      options.storedCount === undefined ? "1" : options.storedCount,
    ),
  } as unknown as CacheService;

  const bookingsRepository = {
    findById: jest.fn(async () =>
      options.bookingRequest === undefined
        ? { id: BOOKING_ID, renterId: RENTER_ID, organizationId: "org-1" }
        : options.bookingRequest,
    ),
  } as unknown as BookingsRepository;

  const authRepository = {
    findUserById: jest.fn(async () => ({
      id: RENTER_ID,
      profile: { username: options.username ?? "renter-one" },
    })),
  } as unknown as AuthRepository;

  return {
    service: new BookingMessagePresenceService(
      cacheService,
      bookingsRepository,
      authRepository,
    ),
    cacheService,
    authRepository,
  };
}

function publishedEvent(cacheService: CacheService, call = 0) {
  const [channel, payload] = (cacheService.publish as jest.Mock).mock.calls[
    call
  ];
  return { channel, event: JSON.parse(payload) };
}

describe("BookingMessagePresenceService", () => {
  describe("typing", () => {
    it("publishes an expiring indicator on the thread channel", async () => {
      const { service, cacheService } = createService();

      await service.publishTyping(BOOKING_ID, RENTER_ID);

      const { channel, event } = publishedEvent(cacheService);
      expect(channel).toBe(CHANNEL);
      expect(event).toMatchObject({
        type: "typing",
        bookingRequestId: BOOKING_ID,
        side: "renter",
        username: "renter-one",
      });

      // Self-expiring: a sender who goes quiet or drops must not stay "typing".
      const remaining = new Date(event.expiresAt).getTime() - Date.now();
      expect(remaining).toBeLessThanOrEqual(
        BOOKING_MESSAGE_TYPING_TTL_SECONDS * 1_000,
      );
      expect(remaining).toBeGreaterThan(0);
    });

    it("resolves the organization side for a non-renter", async () => {
      const { service, cacheService } = createService();

      await service.publishTyping(BOOKING_ID, "manager-1");

      expect(publishedEvent(cacheService).event).toMatchObject({
        side: "owner",
      });
    });

    it("stays silent for an unknown booking", async () => {
      const { service, cacheService } = createService({ bookingRequest: null });

      await service.publishTyping(BOOKING_ID, RENTER_ID);

      expect(cacheService.publish).not.toHaveBeenCalled();
    });

    it("never lets a publish failure escape", async () => {
      const { service, cacheService } = createService();
      (cacheService.publish as jest.Mock).mockRejectedValue(
        new Error("redis down"),
      );

      // Ephemeral by definition: losing one must not disturb the socket.
      await expect(
        service.publishTyping(BOOKING_ID, RENTER_ID),
      ).resolves.toBeUndefined();
    });
  });

  describe("presence", () => {
    const KEY = `booking-messages:presence:${BOOKING_ID}:owner`;

    it("announces the first arrival on a side and sets a TTL", async () => {
      const { service, cacheService } = createService({ count: 1 });

      await service.join(BOOKING_ID, "owner");

      expect(cacheService.increment).toHaveBeenCalledWith(KEY, 1);
      expect(cacheService.expire).toHaveBeenCalledWith(
        KEY,
        BOOKING_MESSAGE_PRESENCE_TTL_SECONDS,
      );
      expect(publishedEvent(cacheService).event).toMatchObject({
        type: "presence",
        state: "online",
        side: "owner",
      });
    });

    it("stays quiet when a colleague joins a side that is already present", async () => {
      const { service, cacheService } = createService({ count: 2 });

      await service.join(BOOKING_ID, "owner");

      // The other party already sees the organization as here; a second manager
      // arriving is not a transition, and re-announcing would be noise.
      expect(cacheService.publish).not.toHaveBeenCalled();
    });

    it("announces offline only when the last of a side leaves", async () => {
      const { service, cacheService } = createService({ count: 0 });

      await service.leave(BOOKING_ID, "owner");

      expect(cacheService.increment).toHaveBeenCalledWith(KEY, -1);
      expect(cacheService.delete).toHaveBeenCalledWith(KEY);
      expect(publishedEvent(cacheService).event).toMatchObject({
        type: "presence",
        state: "offline",
        side: "owner",
      });
    });

    it("keeps a side present while another socket for it remains", async () => {
      const { service, cacheService } = createService({ count: 1 });

      await service.leave(BOOKING_ID, "owner");

      // The count is what decides, not this process's socket map: with the API
      // replicated, the surviving socket may be on another instance entirely.
      expect(cacheService.publish).not.toHaveBeenCalled();
      expect(cacheService.delete).not.toHaveBeenCalled();
      expect(cacheService.expire).toHaveBeenCalledWith(
        KEY,
        BOOKING_MESSAGE_PRESENCE_TTL_SECONDS,
      );
    });

    it("recovers from a negative count left by a process that died", async () => {
      const { service, cacheService } = createService({ count: -2 });

      await service.leave(BOOKING_ID, "owner");

      // Left negative, the next arrival would increment to -1 rather than 1 and
      // its announcement would be swallowed, so the side would never light up
      // again. Removing the key resets that.
      expect(cacheService.delete).toHaveBeenCalledWith(KEY);
      expect(publishedEvent(cacheService).event).toMatchObject({
        state: "offline",
      });
    });

    it("pushes out the TTL without touching the count", async () => {
      const { service, cacheService } = createService();

      await service.refresh(BOOKING_ID, "owner");

      // A refresh that incremented would inflate the count on every sweep and
      // the side would never go offline.
      expect(cacheService.expire).toHaveBeenCalledWith(
        KEY,
        BOOKING_MESSAGE_PRESENCE_TTL_SECONDS,
      );
      expect(cacheService.increment).not.toHaveBeenCalled();
    });

    it("reports whether a side is currently watching", async () => {
      const { service } = createService({ storedCount: "2" });

      await expect(service.isSideOnline(BOOKING_ID, "owner")).resolves.toBe(
        true,
      );
    });

    it("treats a missing or exhausted key as offline", async () => {
      const missing = createService({ storedCount: null });
      await expect(
        missing.service.isSideOnline(BOOKING_ID, "owner"),
      ).resolves.toBe(false);

      const drained = createService({ storedCount: "0" });
      await expect(
        drained.service.isSideOnline(BOOKING_ID, "owner"),
      ).resolves.toBe(false);
    });

    it("stays quiet when the booking behind the event is gone", async () => {
      const { service, cacheService } = createService({
        bookingRequest: null,
        count: 0,
      });

      await service.leave(BOOKING_ID, "owner");

      expect(cacheService.publish).not.toHaveBeenCalled();
    });
  });
});
