import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { BookingsRepository } from "@/features/bookings/bookings.repository";
import { BOOKING_MESSAGE_NOTIFY_COOLDOWN_SECONDS } from "@/features/bookings/messages/booking-messages.model";
import type { BookingMessagesRepository } from "@/features/bookings/messages/booking-messages.repository";
import { BookingMessagesService } from "@/features/bookings/messages/booking-messages.service";
import type { CacheService } from "@/features/cache/cache.service";
import type { EmailService } from "@/features/email/email.service";
import type { TokenService } from "@/features/auth/token/token.service";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { OrganizationsMembersRepository } from "@/features/organizations/members/members.repository";
import { testUuid } from "../../../support/uuid";
const MANAGER_2_ID = testUuid(9000, 836504);

const MESSAGE_1_ID = testUuid(9000, 597033);
const OPERATOR_1_ID = testUuid(9000, 402986);
const OUTSIDER_1_ID = testUuid(9000, 796024);

const RENTER_ID = testUuid(9100, 235000);
const ORG_ID = "org-1";
const BOOKING_ID = testUuid(9100, 996753);
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
    id: MESSAGE_1_ID,
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
    ticketIdentity?: unknown;
    deliveredIds?: string[];
    sessionError?: Error;
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
    updateBodyIfEligible: jest.fn(async () =>
      createMessage({ editedAt: "2026-08-10T12:30:00.000Z" }),
    ),
    softDeleteIfEligible: jest.fn(async () =>
      createMessage({ body: "", deletedAt: "2026-08-10T12:40:00.000Z" }),
    ),
    markReadForSide: jest.fn(async () => options.markedCount ?? 0),
    markDeliveredForSide: jest.fn(async () => options.deliveredIds ?? []),
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
  } as unknown as OrganizationsMembersRepository;

  const cacheService = {
    publish: jest.fn(async () => {
      if (options.publishError) {
        throw options.publishError;
      }
      return 1;
    }),
    setIfNotExists: jest.fn(async () => options.cooldownClaimed ?? true),
    delete: jest.fn(async () => true),
    setJson: jest.fn(async () => undefined),
    getJson: jest.fn(async () => options.ticketIdentity ?? null),
    getDeleteJson: jest.fn(async () => options.ticketIdentity ?? null),
  } as unknown as CacheService;

  const emailService = {
    sendBookingMessageNotificationEmail: jest.fn(async () => {
      if (options.emailError) {
        throw options.emailError;
      }
    }),
  } as unknown as EmailService;

  const realtimeGateway = {
    publish: jest.fn(() => {
      if (options.publishError) {
        throw options.publishError;
      }
    }),
  };

  const tokenService = {
    assertSessionIsUsable: jest.fn(async () => {
      if (options.sessionError) {
        throw options.sessionError;
      }
    }),
  } as unknown as TokenService;

  const service = new BookingMessagesService(
    bookingMessagesRepository,
    bookingsRepository,
    organizationAccessService,
    organizationsRepository,
    cacheService,
    emailService,
    tokenService,
    realtimeGateway,
  );

  return {
    service,
    bookingsRepository,
    bookingMessagesRepository,
    organizationAccessService,
    organizationsRepository,
    cacheService,
    emailService,
    tokenService,
    realtimeGateway,
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
      ).resolves.toMatchObject({ id: MESSAGE_1_ID, authorSide: "renter" });

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
          authorId: OPERATOR_1_ID,
          body: "hello",
        }),
      ).rejects.toMatchObject({
        status: 403,
        message: "You do not have permission to manage this booking request.",
      });
    });

    it("still resolves when the stream publish fails", async () => {
      const { service, realtimeGateway } = createService({
        publishError: new Error("redis down"),
      });

      await expect(
        service.send({
          bookingRequestId: BOOKING_ID,
          authorId: RENTER_ID,
          body: "hello",
        }),
      ).resolves.toMatchObject({ id: MESSAGE_1_ID });

      expect(realtimeGateway.publish).toHaveBeenCalled();
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
      ).resolves.toMatchObject({ id: MESSAGE_1_ID });

      expect(
        emailService.sendBookingMessageNotificationEmail,
      ).toHaveBeenCalled();
    });

    it("publishes a message.created event to the thread", async () => {
      const { service, cacheService, realtimeGateway } = createService();

      await service.send({
        bookingRequestId: BOOKING_ID,
        authorId: RENTER_ID,
        body: "hello",
      });

      const [event] = (realtimeGateway.publish as jest.Mock).mock.calls[0];
      expect(event).toMatchObject({
        type: "message.created",
        bookingRequestId: BOOKING_ID,
        message: { id: MESSAGE_1_ID },
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
        messageId: MESSAGE_1_ID,
      });
    });

    it("notifies the renter when the organization writes", async () => {
      const { service, emailService, bookingMessagesRepository } =
        createService();
      (bookingMessagesRepository.create as jest.Mock).mockResolvedValue(
        createMessage({ authorId: MANAGER_2_ID, authorSide: "owner" }),
      );

      await service.send({
        bookingRequestId: BOOKING_ID,
        authorId: MANAGER_2_ID,
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
          actorUserId: OPERATOR_1_ID,
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
          actorUserId: MANAGER_2_ID,
          page: 1,
          pageSize: 20,
        }),
      ).resolves.toMatchObject({ canWrite: true, viewerSide: "owner" });

      const operator = createService({ role: "operator" });
      await expect(
        operator.service.list({
          bookingRequestId: BOOKING_ID,
          actorUserId: OPERATOR_1_ID,
          page: 1,
          pageSize: 20,
        }),
      ).resolves.toMatchObject({ canWrite: false, viewerSide: "owner" });
    });

    it("rejects a non-party", async () => {
      const membershipError = new ForbiddenError(
        "You do not have access to this booking request.",
      );
      const { service, realtimeGateway } = createService({ membershipError });

      await expect(
        service.list({
          bookingRequestId: BOOKING_ID,
          actorUserId: OUTSIDER_1_ID,
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
      const { service, bookingMessagesRepository, realtimeGateway } =
        createService();
      (bookingMessagesRepository.findById as jest.Mock).mockResolvedValue(
        createMessage({ createdAt: recent() }),
      );

      await expect(
        service.edit({
          bookingRequestId: BOOKING_ID,
          messageId: MESSAGE_1_ID,
          actorUserId: RENTER_ID,
          body: "Corrected",
        }),
      ).resolves.toMatchObject({ editedAt: expect.any(String) });

      const [event] = (realtimeGateway.publish as jest.Mock).mock.calls[0];
      expect(event).toMatchObject({ type: "message.updated" });
    });

    it("soft deletes the author's own recent message", async () => {
      const { service, bookingMessagesRepository } = createService();
      (bookingMessagesRepository.findById as jest.Mock).mockResolvedValue(
        createMessage({ createdAt: recent() }),
      );

      await expect(
        service.remove({
          bookingRequestId: BOOKING_ID,
          messageId: MESSAGE_1_ID,
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
          messageId: MESSAGE_1_ID,
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
          messageId: MESSAGE_1_ID,
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
          messageId: MESSAGE_1_ID,
          actorUserId: RENTER_ID,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("releases the notification cooldown when the enqueue fails", async () => {
      const { service, cacheService } = createService({
        emailError: new Error("rabbitmq down"),
      });

      await service.send({
        bookingRequestId: BOOKING_ID,
        authorId: RENTER_ID,
        body: "hello",
      });

      // Holding the claim would mute every notification for this pair for the
      // full window after one transient broker failure.
      expect(cacheService.delete).toHaveBeenCalledWith(
        `booking-messages:notify:${BOOKING_ID}:${PRIMARY_MANAGER_ID}`,
      );
    });

    it("rejects a change that lost a race with a concurrent delete", async () => {
      const { service, bookingMessagesRepository } = createService();
      (bookingMessagesRepository.findById as jest.Mock).mockResolvedValue(
        createMessage({ createdAt: new Date().toISOString() }),
      );
      // The conditional write matched no row: something else got there first.
      (
        bookingMessagesRepository.updateBodyIfEligible as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        service.edit({
          bookingRequestId: BOOKING_ID,
          messageId: MESSAGE_1_ID,
          actorUserId: RENTER_ID,
          body: "Too late",
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
          messageId: MESSAGE_1_ID,
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

      await service.markRead(BOOKING_ID, MANAGER_2_ID);

      expect(bookingMessagesRepository.markReadForSide).toHaveBeenCalledWith(
        expect.objectContaining({ side: "owner" }),
      );
    });

    it("publishes a messages.read event when something was marked", async () => {
      const { service, cacheService, realtimeGateway } = createService({
        markedCount: 2,
      });

      await service.markRead(BOOKING_ID, RENTER_ID);

      const [event] = (realtimeGateway.publish as jest.Mock).mock.calls[0];
      expect(event).toMatchObject({
        type: "messages.read",
        readerSide: "renter",
        markedCount: 2,
      });
    });

    it("does not publish when nothing was marked", async () => {
      const { service, cacheService, realtimeGateway } = createService({
        markedCount: 0,
      });

      await service.markRead(BOOKING_ID, RENTER_ID);

      expect(realtimeGateway.publish).not.toHaveBeenCalled();
    });

    it("requires a manager role on the organization side", async () => {
      const { service } = createService({ role: "operator" });

      await expect(
        service.markRead(BOOKING_ID, OPERATOR_1_ID),
      ).rejects.toMatchObject({
        status: 403,
        message: "You do not have permission to manage this booking request.",
      });
    });
  });

  describe("socket tickets", () => {
    it("mints a ticket only for an authorized participant", async () => {
      const { service, cacheService } = createService();

      const issued = await service.createSocketTicket(BOOKING_ID, RENTER_ID);

      expect(issued.ticket).toHaveLength(43);
      expect(issued.expiresInSeconds).toBeGreaterThan(0);
      expect(cacheService.setJson).toHaveBeenCalledWith(
        `booking-messages:ws-ticket:${issued.ticket}`,
        {
          bookingRequestId: BOOKING_ID,
          userId: RENTER_ID,
          sessionId: null,
          tokenVersion: null,
        },
        expect.any(Number),
      );
    });

    it("records the minting session so the socket can be rechecked", async () => {
      const { service, cacheService } = createService();

      const issued = await service.createSocketTicket(BOOKING_ID, RENTER_ID, {
        sessionId: "session-9",
        tokenVersion: 3,
      });

      expect(cacheService.setJson).toHaveBeenCalledWith(
        `booking-messages:ws-ticket:${issued.ticket}`,
        {
          bookingRequestId: BOOKING_ID,
          userId: RENTER_ID,
          sessionId: "session-9",
          tokenVersion: 3,
        },
        expect.any(Number),
      );
    });

    it("refuses to mint for a non-party", async () => {
      const membershipError = new ForbiddenError(
        "You do not have access to this booking request.",
      );
      const { service } = createService({ membershipError });

      await expect(
        service.createSocketTicket(BOOKING_ID, OUTSIDER_1_ID),
      ).rejects.toBe(membershipError);
    });

    it("consumes a ticket on redemption", async () => {
      const { service, cacheService } = createService({
        ticketIdentity: { bookingRequestId: BOOKING_ID, userId: RENTER_ID },
      });

      await expect(service.redeemSocketTicket("abc")).resolves.toEqual({
        bookingRequestId: BOOKING_ID,
        userId: RENTER_ID,
      });

      // Read and removed in one operation. A read followed by a separate delete
      // let two concurrent upgrades both observe the ticket before either
      // removed it, so both were admitted.
      expect(cacheService.getDeleteJson).toHaveBeenCalledWith(
        "booking-messages:ws-ticket:abc",
      );
      expect(cacheService.getJson).not.toHaveBeenCalled();
      expect(cacheService.delete).not.toHaveBeenCalled();
    });

    it("rejects an unknown or empty ticket", async () => {
      const { service } = createService();

      await expect(service.redeemSocketTicket("nope")).resolves.toBeNull();
      await expect(service.redeemSocketTicket("")).resolves.toBeNull();
    });

    it("rejects a ticket whose holder lost access after minting", async () => {
      const { service } = createService({
        ticketIdentity: { bookingRequestId: BOOKING_ID, userId: "removed-1" },
        membershipError: new ForbiddenError("No access."),
      });

      await expect(service.redeemSocketTicket("abc")).resolves.toBeNull();
    });

    it("refuses a ticket whose session was revoked before the upgrade landed", async () => {
      const { service, tokenService } = createService({
        ticketIdentity: {
          bookingRequestId: BOOKING_ID,
          userId: RENTER_ID,
          sessionId: "session-9",
          tokenVersion: 3,
        },
        sessionError: new Error("Session is no longer valid."),
      });

      // Membership is untouched here. The window is small — the ticket lives 30
      // seconds — but the periodic sweep only closes sockets that exist, so
      // without this check a signed-out user could still open a fresh one.
      await expect(service.redeemSocketTicket("abc")).resolves.toBeNull();
      expect(tokenService.assertSessionIsUsable).toHaveBeenCalledWith(
        RENTER_ID,
        "session-9",
        3,
      );
    });

    it("passes the recorded session to the token service on recheck", async () => {
      const { service, tokenService } = createService();

      await service.assertSocketSessionValid({
        bookingRequestId: BOOKING_ID,
        userId: RENTER_ID,
        sessionId: "session-9",
        tokenVersion: 3,
      });

      expect(tokenService.assertSessionIsUsable).toHaveBeenCalledWith(
        RENTER_ID,
        "session-9",
        3,
      );
    });

    it("surfaces a revoked session so the socket can be closed", async () => {
      const sessionError = new Error("Session is no longer valid.");
      const { service } = createService({ sessionError });

      // Membership can still be perfectly valid here: this is the signed-out
      // user whose REST calls are all failing while the socket streams on.
      await expect(
        service.assertSocketSessionValid({
          bookingRequestId: BOOKING_ID,
          userId: RENTER_ID,
          sessionId: "session-9",
          tokenVersion: 3,
        }),
      ).rejects.toBe(sessionError);
    });
  });

  describe("markDelivered", () => {
    it("publishes only the rows it actually marked", async () => {
      const { service, cacheService, realtimeGateway } = createService({
        deliveredIds: [MESSAGE_1_ID],
      });

      await expect(
        service.markDelivered(BOOKING_ID, RENTER_ID, [MESSAGE_1_ID]),
      ).resolves.toEqual([MESSAGE_1_ID]);

      const [event] = (realtimeGateway.publish as jest.Mock).mock.calls[0];
      expect(event).toMatchObject({
        type: "messages.delivered",
        messageIds: [MESSAGE_1_ID],
      });
    });

    it("stays silent when nothing was newly delivered", async () => {
      const { service, cacheService, realtimeGateway } = createService({
        deliveredIds: [],
      });

      await expect(
        service.markDelivered(BOOKING_ID, RENTER_ID, [MESSAGE_1_ID]),
      ).resolves.toEqual([]);
      expect(realtimeGateway.publish).not.toHaveBeenCalled();
    });

    it("allows a read-only member to acknowledge receipt", async () => {
      // Acking is not a write to the conversation, so the manage bar does not
      // apply: an operator still receives the messages.
      const { service } = createService({
        role: "operator",
        deliveredIds: [MESSAGE_1_ID],
      });

      await expect(
        service.markDelivered(BOOKING_ID, OPERATOR_1_ID, [MESSAGE_1_ID]),
      ).resolves.toEqual([MESSAGE_1_ID]);
    });
  });

  describe("authorizeStream", () => {
    it("resolves the side and write capability for a party", async () => {
      const { service } = createService();

      await expect(
        service.authorizeStream(BOOKING_ID, RENTER_ID),
      ).resolves.toEqual({
        bookingRequestId: BOOKING_ID,
        side: "renter",
        canWrite: true,
      });
    });

    it("admits a read-only member without write capability", async () => {
      // An organization operator: entitled to watch the thread, not to post to
      // it. The socket needs both facts — one to let them connect, the other to
      // refuse the frames only a writer should be able to emit.
      const { service } = createService({
        role: "operator",
        manageError: new ForbiddenError("Operators cannot write."),
      });

      await expect(
        service.authorizeStream(BOOKING_ID, OPERATOR_1_ID),
      ).resolves.toEqual({
        bookingRequestId: BOOKING_ID,
        side: "owner",
        canWrite: false,
      });
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
        service.authorizeStream(BOOKING_ID, OUTSIDER_1_ID),
      ).rejects.toBe(membershipError);
    });
  });
});
