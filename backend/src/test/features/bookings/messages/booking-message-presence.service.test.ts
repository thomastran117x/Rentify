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
    alreadyOnline?: boolean;
    removed?: boolean;
  } = {},
) {
  const cacheService = {
    publish: jest.fn(async () => 1),
    setIfNotExists: jest.fn(async () => !options.alreadyOnline),
    expire: jest.fn(async () => true),
    delete: jest.fn(async () => options.removed ?? true),
    exists: jest.fn(async () => true),
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
    it("announces a newly online viewer and sets a TTL", async () => {
      const { service, cacheService } = createService();

      await service.markOnline(BOOKING_ID, RENTER_ID);

      expect(cacheService.setIfNotExists).toHaveBeenCalledWith(
        `booking-messages:presence:${BOOKING_ID}:${RENTER_ID}`,
        "1",
        BOOKING_MESSAGE_PRESENCE_TTL_SECONDS,
      );
      expect(publishedEvent(cacheService).event).toMatchObject({
        type: "presence",
        state: "online",
        side: "renter",
      });
    });

    it("refreshes a heartbeat without re-announcing", async () => {
      const { service, cacheService } = createService({ alreadyOnline: true });

      await service.markOnline(BOOKING_ID, RENTER_ID);

      expect(cacheService.expire).toHaveBeenCalledWith(
        `booking-messages:presence:${BOOKING_ID}:${RENTER_ID}`,
        BOOKING_MESSAGE_PRESENCE_TTL_SECONDS,
      );
      expect(cacheService.publish).not.toHaveBeenCalled();
    });

    it("announces going offline once", async () => {
      const { service, cacheService } = createService();

      await service.markOffline(BOOKING_ID, RENTER_ID);

      expect(publishedEvent(cacheService).event).toMatchObject({
        type: "presence",
        state: "offline",
      });
    });

    it("reports whether a user is currently watching the thread", async () => {
      const { service, cacheService } = createService();

      await expect(service.isOnline(BOOKING_ID, RENTER_ID)).resolves.toBe(true);
      expect(cacheService.exists).toHaveBeenCalledWith(
        `booking-messages:presence:${BOOKING_ID}:${RENTER_ID}`,
      );
    });

    it("stays quiet when the booking behind the presence event is gone", async () => {
      const { service, cacheService } = createService({ bookingRequest: null });

      await service.markOffline(BOOKING_ID, RENTER_ID);

      // A deleted booking has no sides to describe, so there is nothing
      // meaningful to announce and no channel worth publishing to.
      expect(cacheService.publish).not.toHaveBeenCalled();
    });

    it("announces going offline even when the key had already expired", async () => {
      const { service, cacheService } = createService({ removed: false });

      await service.markOffline(BOOKING_ID, RENTER_ID);

      // Keying the announcement off the delete result meant that a key which
      // lapsed between refreshes swallowed the offline event, leaving the
      // counterpart's dot lit for good. Not announcing for a second tab is the
      // socket server's job — it only calls this once the user's last socket on
      // the thread has gone — so Redis is not consulted about a transition the
      // caller already knows about.
      expect(publishedEvent(cacheService).event).toMatchObject({
        type: "presence",
        state: "offline",
      });
    });
  });
});
