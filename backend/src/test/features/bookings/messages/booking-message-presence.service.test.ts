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
    /** How many live leases remain after the call under test. */
    liveLeases?: number;
  } = {},
) {
  const cacheService = {
    publish: jest.fn(async () => 1),
    addToLeaseSet: jest.fn(async () => undefined),
    removeFromLeaseSet: jest.fn(async () => undefined),
    countLiveLeases: jest.fn(async () => options.liveLeases ?? 1),
    expire: jest.fn(async () => true),
    delete: jest.fn(async () => true),
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

    it("announces the first arrival on a side and leases it", async () => {
      const { service, cacheService } = createService({ liveLeases: 1 });

      await service.join(BOOKING_ID, "owner", "socket-a");

      expect(cacheService.addToLeaseSet).toHaveBeenCalledWith(
        KEY,
        "socket-a",
        expect.any(Number),
      );
      expect(publishedEvent(cacheService).event).toMatchObject({
        type: "presence",
        state: "online",
        side: "owner",
      });
    });

    it("stays quiet when a colleague joins a side that is already present", async () => {
      const { service, cacheService } = createService({ liveLeases: 2 });

      await service.join(BOOKING_ID, "owner", "socket-b");

      expect(cacheService.publish).not.toHaveBeenCalled();
    });

    it("announces offline when the last lease on a side goes", async () => {
      const { service, cacheService } = createService({ liveLeases: 0 });

      await service.leave(BOOKING_ID, "owner", "socket-a");

      expect(cacheService.removeFromLeaseSet).toHaveBeenCalledWith(
        KEY,
        "socket-a",
      );
      expect(cacheService.delete).toHaveBeenCalledWith(KEY);
      expect(publishedEvent(cacheService).event).toMatchObject({
        state: "offline",
        side: "owner",
      });
    });

    it("keeps a side present while a lease remains anywhere", async () => {
      const { service, cacheService } = createService({ liveLeases: 1 });

      await service.leave(BOOKING_ID, "owner", "socket-a");

      // The remaining lease may belong to a socket on another replica, which
      // this process cannot see. Only the shared set knows.
      expect(cacheService.publish).not.toHaveBeenCalled();
      expect(cacheService.delete).not.toHaveBeenCalled();
    });

    it("counts after mutating, so a join racing a departure wins", async () => {
      const { service, cacheService } = createService({ liveLeases: 1 });

      await service.leave(BOOKING_ID, "owner", "socket-a");

      // Ordering is the whole guarantee: the newcomer's lease is already in the
      // set when this counts, so the departure sees it and stays quiet. Counting
      // first would have published offline over an online just sent.
      const order = (cacheService.removeFromLeaseSet as jest.Mock).mock
        .invocationCallOrder[0];
      const countOrder = (cacheService.countLiveLeases as jest.Mock).mock
        .invocationCallOrder[0];
      expect(order).toBeLessThan(countOrder);
      expect(cacheService.publish).not.toHaveBeenCalled();
    });

    it("renews only its own lease", async () => {
      const { service, cacheService } = createService();

      await service.refresh(BOOKING_ID, "owner", "socket-a");

      // Renewing the key as a whole would carry a dead replica's lease along
      // with it, and the side would never be announced offline again.
      expect(cacheService.addToLeaseSet).toHaveBeenCalledWith(
        KEY,
        "socket-a",
        expect.any(Number),
      );
      expect(cacheService.publish).not.toHaveBeenCalled();
    });

    it("reports a side with a live lease as online", async () => {
      const { service } = createService({ liveLeases: 2 });

      await expect(service.isSideOnline(BOOKING_ID, "owner")).resolves.toBe(
        true,
      );
    });

    it("treats a side whose leases have all expired as offline", async () => {
      const { service, cacheService } = createService({ liveLeases: 0 });

      await expect(service.isSideOnline(BOOKING_ID, "owner")).resolves.toBe(
        false,
      );
      // Expired leases are pruned on read: a crashed holder leaves nothing
      // behind to come back and remove them.
      expect(cacheService.countLiveLeases).toHaveBeenCalledWith(
        KEY,
        expect.any(Number),
      );
    });

    it("stays quiet when the booking behind the event is gone", async () => {
      const { service, cacheService } = createService({
        bookingRequest: null,
        liveLeases: 0,
      });

      await service.leave(BOOKING_ID, "owner", "socket-a");

      expect(cacheService.publish).not.toHaveBeenCalled();
    });
  });
});
