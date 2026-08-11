import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { BookingsRepository } from "@/features/bookings/bookings.repository";
import { BOOKING_MESSAGE_NOTIFY_COOLDOWN_SECONDS } from "@/features/bookings/messages/booking-messages.model";
import type { BookingMessagesRepository } from "@/features/bookings/messages/booking-messages.repository";
import { BookingMessagesService } from "@/features/bookings/messages/booking-messages.service";
import type { CacheService } from "@/features/cache/cache.service";
import type { EmailService } from "@/features/email/email.service";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { OrganizationsRepository } from "@/features/organizations/organizations.repository";

const RENTER_ID = "renter-1";
const ORG_ID = "org-1";
const BOOKING_ID = "booking-1";
const PRIMARY_MANAGER_ID = "manager-1";

function createBookingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    renterId: RENTER_ID,
    organizationId: ORG_ID,
    ...overrides,
  } as any;
}

function createMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "message-1",
    bookingRequestId: BOOKING_ID,
    authorId: RENTER_ID,
    authorSide: "renter",
    body: "Is the van available early?",
    createdAt: "2026-08-10T12:00:00.000Z",
    readAt: null,
    ...overrides,
  } as any;
}

function createService(
  options: {
    bookingRequest?: unknown;
    role?: string;
    membershipError?: Error;
    manageError?: Error;
    primaryManagerUserId?: string | null;
    cooldownClaimed?: boolean;
    publishError?: Error;
    emailError?: Error;
    markedCount?: number;
    unreadCount?: number;
  } = {},
) {
  const bookingsRepository = {
    findById: jest.fn(async () =>
      options.bookingRequest === undefined
        ? createBookingRequest()
        : options.bookingRequest,
    ),
  } as unknown as BookingsRepository;

  const bookingMessagesRepository = {
    create: jest.fn(async () => createMessage()),
    listByBookingRequest: jest.fn(async () => ({
      messages: [createMessage()],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })),
    countUnreadForSide: jest.fn(async () => options.unreadCount ?? 0),
    findThreadParties: jest.fn(async () => ({
      organizationName: "Maya Santos Organization",
      renterUsername: "renter-one",
    })),
    findById: jest.fn(async () => createMessage()),
    updateBody: jest.fn(async () =>
      createMessage({ editedAt: "2026-08-10T12:30:00.000Z" }),
    ),
    softDelete: jest.fn(async () =>
      createMessage({ body: "", deletedAt: "2026-08-10T12:40:00.000Z" }),
    ),
    markReadForSide: jest.fn(async () => options.markedCount ?? 0),
  } as unknown as BookingMessagesRepository;

  const organizationAccessService = {
    requireMembership: jest.fn(async () => {
      if (options.membershipError) {
        throw options.membershipError;
      }
      return { organizationId: ORG_ID, role: options.role ?? "manager" };
    }),
    assertCanManage: jest.fn(() => {
      if (options.manageError) {
        throw options.manageError;
      }
    }),
    canManage: jest.fn((role: string) => {
      if (options.manageError) {
        return false;
      }
      return role === "primary_manager" || role === "manager";
    }),
  } as unknown as OrganizationAccessService;

  const organizationsRepository = {
    findPrimaryManagerUserId: jest.fn(async () =>
      options.primaryManagerUserId === undefined
        ? PRIMARY_MANAGER_ID
        : options.primaryManagerUserId,
    ),
  } as unknown as OrganizationsRepository;

  const cacheService = {
    publish: jest.fn(async () => {
      if (options.publishError) {
        throw options.publishError;
      }
      return 1;
    }),
    setIfNotExists: jest.fn(async () => options.cooldownClaimed ?? true),
  } as unknown as CacheService;

  const emailService = {
    sendBookingMessageNotificationEmail: jest.fn(async () => {
      if (options.emailError) {
        throw options.emailError;
      }
    }),
  } as unknown as EmailService;

  const service = new BookingMessagesService(
    bookingMessagesRepository,
    bookingsRepository,
    organizationAccessService,
    organizationsRepository,
    cacheService,
    emailService,
  );

  return {
    service,
    bookingsRepository,
    bookingMessagesRepository,
    organizationAccessService,
    organizationsRepository,
    cacheService,
    emailService,
  };
}

describe("BookingMessagesService", () => {
  describe("send", () => {
    it("rejects an unknown booking request", async () => {
      const { service } = createService({ bookingRequest: null });

      await expect(
        service.send({
          bookingRequestId: BOOKING_ID,
          authorId: RENTER_ID,
          body: "hello",
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("persists a renter message with the booking's renter id", async () => {
      const { service, bookingMessagesRepository } = createService();

      await expect(
        service.send({
          bookingRequestId: BOOKING_ID,
          authorId: RENTER_ID,
          body: "hello",
        }),
      ).resolves.toMatchObject({ id: "message-1", authorSide: "renter" });

      expect(bookingMessagesRepository.create).toHaveBeenCalledWith({
        bookingRequestId: BOOKING_ID,
        authorId: RENTER_ID,
        body: "hello",
        renterId: RENTER_ID,
      });
    });

    it("rejects an operator on the organization side", async () => {
      const { service } = createService({ role: "operator" });

      await expect(
        service.send({
          bookingRequestId: BOOKING_ID,
          authorId: "operator-1",
          body: "hello",
        }),
      ).rejects.toMatchObject({
        status: 403,
        message: "You do not have permission to manage this booking request.",
      });
    });

    it("still resolves when the stream publish fails", async () => {
      const { service, cacheService } = createService({
        publishError: new Error("redis down"),
      });

      await expect(
        service.send({
          bookingRequestId: BOOKING_ID,
          authorId: RENTER_ID,
          body: "hello",
        }),
      ).resolves.toMatchObject({ id: "message-1" });

      expect(cacheService.publish).toHaveBeenCalled();
    });

    it("still resolves when queueing the notification fails", async () => {
      const { service, emailService } = createService({
        emailError: new Error("rabbitmq down"),
      });

      await expect(
        service.send({
          bookingRequestId: BOOKING_ID,
          authorId: RENTER_ID,
          body: "hello",
        }),
      ).resolves.toMatchObject({ id: "message-1" });

      expect(
        emailService.sendBookingMessageNotificationEmail,
      ).toHaveBeenCalled();
    });

    it("publishes a message.created event on the thread channel", async () => {
      const { service, cacheService } = createService();

      await service.send({
        bookingRequestId: BOOKING_ID,
        authorId: RENTER_ID,
        body: "hello",
      });

      const [channel, payload] = (cacheService.publish as jest.Mock).mock
        .calls[0];
      expect(channel).toBe(`booking-messages:${BOOKING_ID}`);
      expect(JSON.parse(payload)).toMatchObject({
        type: "message.created",
        bookingRequestId: BOOKING_ID,
        message: { id: "message-1" },
      });
    });

    it("notifies the primary manager when the renter writes", async () => {
      const { service, emailService, cacheService } = createService();

      await service.send({
        bookingRequestId: BOOKING_ID,
        authorId: RENTER_ID,
        body: "hello",
      });

      expect(cacheService.setIfNotExists).toHaveBeenCalledWith(
        `booking-messages:notify:${BOOKING_ID}:${PRIMARY_MANAGER_ID}`,
        "1",
        BOOKING_MESSAGE_NOTIFY_COOLDOWN_SECONDS,
      );
      expect(
        emailService.sendBookingMessageNotificationEmail,
      ).toHaveBeenCalledWith({
        bookingRequestId: BOOKING_ID,
        recipientId: PRIMARY_MANAGER_ID,
        messageId: "message-1",
      });
    });

    it("notifies the renter when the organization writes", async () => {
      const { service, emailService, bookingMessagesRepository } =
        createService();
      (bookingMessagesRepository.create as jest.Mock).mockResolvedValue(
        createMessage({ authorId: "manager-2", authorSide: "owner" }),
      );

      await service.send({
        bookingRequestId: BOOKING_ID,
        authorId: "manager-2",
        body: "hello",
      });

      expect(
        emailService.sendBookingMessageNotificationEmail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: RENTER_ID }),
      );
    });

    it("skips the notification when the organization has no primary manager", async () => {
      const { service, emailService } = createService({
        primaryManagerUserId: null,
      });

      await service.send({
        bookingRequestId: BOOKING_ID,
        authorId: RENTER_ID,
        body: "hello",
      });

      expect(
        emailService.sendBookingMessageNotificationEmail,
      ).not.toHaveBeenCalled();
    });

    it("never notifies an author about their own message", async () => {
      // A primary manager can also be the renter on another organization's
      // posting, so the recipient and author can resolve to the same user.
      const { service, emailService } = createService({
        primaryManagerUserId: RENTER_ID,
      });

      await service.send({
        bookingRequestId: BOOKING_ID,
        authorId: RENTER_ID,
        body: "hello",
      });

      expect(
        emailService.sendBookingMessageNotificationEmail,
      ).not.toHaveBeenCalled();
    });

    it("suppresses the notification while the cooldown is held", async () => {
      const { service, emailService } = createService({
        cooldownClaimed: false,
      });

      await service.send({
        bookingRequestId: BOOKING_ID,
        authorId: RENTER_ID,
        body: "hello",
      });

      expect(
        emailService.sendBookingMessageNotificationEmail,
      ).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("returns the page plus the unread count for the renter side", async () => {
      const { service, bookingMessagesRepository } = createService({
        unreadCount: 3,
      });

      await expect(
        service.list({
          bookingRequestId: BOOKING_ID,
          actorUserId: RENTER_ID,
          page: 2,
          pageSize: 10,
        }),
      ).resolves.toMatchObject({ unreadCount: 3 });

      expect(bookingMessagesRepository.countUnreadForSide).toHaveBeenCalledWith(
        {
          bookingRequestId: BOOKING_ID,
          renterId: RENTER_ID,
          side: "renter",
        },
      );
      expect(
        bookingMessagesRepository.listByBookingRequest,
      ).toHaveBeenCalledWith({
        bookingRequestId: BOOKING_ID,
        renterId: RENTER_ID,
        page: 2,
        pageSize: 10,
      });
    });

    it("allows an operator to read and scopes the unread count to the owner side", async () => {
      const { service, bookingMessagesRepository, organizationAccessService } =
        createService({ role: "operator", unreadCount: 1 });

      await expect(
        service.list({
          bookingRequestId: BOOKING_ID,
          actorUserId: "operator-1",
          page: 1,
          pageSize: 20,
        }),
      ).resolves.toMatchObject({ unreadCount: 1 });

      // Read access must not require a manager role.
      expect(organizationAccessService.assertCanManage).not.toHaveBeenCalled();
      expect(bookingMessagesRepository.countUnreadForSide).toHaveBeenCalledWith(
        expect.objectContaining({ side: "owner" }),
      );
    });

    it("reports the write capability so the client can mirror the API", async () => {
      const renter = createService();
      await expect(
        renter.service.list({
          bookingRequestId: BOOKING_ID,
          actorUserId: RENTER_ID,
          page: 1,
          pageSize: 20,
        }),
      ).resolves.toMatchObject({ canWrite: true, viewerSide: "renter" });

      const manager = createService({ role: "manager" });
      await expect(
        manager.service.list({
          bookingRequestId: BOOKING_ID,
          actorUserId: "manager-2",
          page: 1,
          pageSize: 20,
        }),
      ).resolves.toMatchObject({ canWrite: true, viewerSide: "owner" });

      const operator = createService({ role: "operator" });
      await expect(
        operator.service.list({
          bookingRequestId: BOOKING_ID,
          actorUserId: "operator-1",
          page: 1,
          pageSize: 20,
        }),
      ).resolves.toMatchObject({ canWrite: false, viewerSide: "owner" });
    });

    it("rejects a non-party", async () => {
      const membershipError = new ForbiddenError(
        "You do not have access to this booking request.",
      );
      const { service } = createService({ membershipError });

      await expect(
        service.list({
          bookingRequestId: BOOKING_ID,
          actorUserId: "outsider-1",
          page: 1,
          pageSize: 20,
        }),
      ).rejects.toBe(membershipError);
    });
  });

  describe("edit and remove", () => {
    const recent = () => new Date(Date.now() - 60_000).toISOString();
    const stale = () => new Date(Date.now() - 20 * 60_000).toISOString();

    it("edits the author's own recent message and publishes the update", async () => {
      const { service, bookingMessagesRepository, cacheService } =
        createService();
      (bookingMessagesRepository.findById as jest.Mock).mockResolvedValue(
        createMessage({ createdAt: recent() }),
      );

      await expect(
        service.edit({
          bookingRequestId: BOOKING_ID,
          messageId: "message-1",
          actorUserId: RENTER_ID,
          body: "Corrected",
        }),
      ).resolves.toMatchObject({ editedAt: expect.any(String) });

      const [, payload] = (cacheService.publish as jest.Mock).mock.calls[0];
      expect(JSON.parse(payload)).toMatchObject({ type: "message.updated" });
    });

    it("soft deletes the author's own recent message", async () => {
      const { service, bookingMessagesRepository } = createService();
      (bookingMessagesRepository.findById as jest.Mock).mockResolvedValue(
        createMessage({ createdAt: recent() }),
      );

      await expect(
        service.remove({
          bookingRequestId: BOOKING_ID,
          messageId: "message-1",
          actorUserId: RENTER_ID,
        }),
      ).resolves.toMatchObject({ body: "", deletedAt: expect.any(String) });
    });

    it("rejects changing someone else's message", async () => {
      const { service, bookingMessagesRepository } = createService();
      (bookingMessagesRepository.findById as jest.Mock).mockResolvedValue(
        createMessage({ authorId: "someone-else", createdAt: recent() }),
      );

      await expect(
        service.edit({
          bookingRequestId: BOOKING_ID,
          messageId: "message-1",
          actorUserId: RENTER_ID,
          body: "Not mine",
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("rejects a change outside the edit window", async () => {
      const { service, bookingMessagesRepository } = createService();
      (bookingMessagesRepository.findById as jest.Mock).mockResolvedValue(
        createMessage({ createdAt: stale() }),
      );

      await expect(
        service.edit({
          bookingRequestId: BOOKING_ID,
          messageId: "message-1",
          actorUserId: RENTER_ID,
          body: "Too late",
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects changing an already deleted message", async () => {
      const { service, bookingMessagesRepository } = createService();
      (bookingMessagesRepository.findById as jest.Mock).mockResolvedValue(
        createMessage({
          createdAt: recent(),
          deletedAt: "2026-08-10T12:40:00.000Z",
        }),
      );

      await expect(
        service.remove({
          bookingRequestId: BOOKING_ID,
          messageId: "message-1",
          actorUserId: RENTER_ID,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects a message that belongs to another booking", async () => {
      const { service, bookingMessagesRepository } = createService();
      (bookingMessagesRepository.findById as jest.Mock).mockResolvedValue(
        createMessage({ bookingRequestId: "other-booking" }),
      );

      await expect(
        service.remove({
          bookingRequestId: BOOKING_ID,
          messageId: "message-1",
          actorUserId: RENTER_ID,
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });
  });

  describe("markRead", () => {
    it("marks owner-authored messages when the renter reads", async () => {
      const { service, bookingMessagesRepository } = createService({
        markedCount: 2,
      });

      await expect(
        service.markRead(BOOKING_ID, RENTER_ID),
      ).resolves.toMatchObject({
        bookingRequestId: BOOKING_ID,
        markedCount: 2,
      });

      expect(bookingMessagesRepository.markReadForSide).toHaveBeenCalledWith(
        expect.objectContaining({ side: "renter", renterId: RENTER_ID }),
      );
    });

    it("marks renter-authored messages when the organization reads", async () => {
      const { service, bookingMessagesRepository } = createService({
        markedCount: 1,
      });

      await service.markRead(BOOKING_ID, "manager-2");

      expect(bookingMessagesRepository.markReadForSide).toHaveBeenCalledWith(
        expect.objectContaining({ side: "owner" }),
      );
    });

    it("publishes a messages.read event when something was marked", async () => {
      const { service, cacheService } = createService({ markedCount: 2 });

      await service.markRead(BOOKING_ID, RENTER_ID);

      const [channel, payload] = (cacheService.publish as jest.Mock).mock
        .calls[0];
      expect(channel).toBe(`booking-messages:${BOOKING_ID}`);
      expect(JSON.parse(payload)).toMatchObject({
        type: "messages.read",
        readerSide: "renter",
        markedCount: 2,
      });
    });

    it("does not publish when nothing was marked", async () => {
      const { service, cacheService } = createService({ markedCount: 0 });

      await service.markRead(BOOKING_ID, RENTER_ID);

      expect(cacheService.publish).not.toHaveBeenCalled();
    });

    it("requires a manager role on the organization side", async () => {
      const { service } = createService({ role: "operator" });

      await expect(
        service.markRead(BOOKING_ID, "operator-1"),
      ).rejects.toMatchObject({
        status: 403,
        message: "You do not have permission to manage this booking request.",
      });
    });
  });

  describe("authorizeStream", () => {
    it("resolves the side for a party", async () => {
      const { service } = createService();

      await expect(
        service.authorizeStream(BOOKING_ID, RENTER_ID),
      ).resolves.toEqual({ bookingRequestId: BOOKING_ID, side: "renter" });
    });

    it("rejects an unknown booking request", async () => {
      const { service } = createService({ bookingRequest: null });

      await expect(
        service.authorizeStream(BOOKING_ID, RENTER_ID),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("rejects a non-party", async () => {
      const membershipError = new ForbiddenError(
        "You do not have access to this booking request.",
      );
      const { service } = createService({ membershipError });

      await expect(
        service.authorizeStream(BOOKING_ID, "outsider-1"),
      ).rejects.toBe(membershipError);
    });
  });
});
