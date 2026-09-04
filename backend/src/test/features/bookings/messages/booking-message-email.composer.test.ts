import type { UsersRepository } from "@/features/auth/users/users.repository";
import { BookingMessageEmailComposer } from "@/features/bookings/messages/booking-message-email.composer";
import type { BookingMessagesRepository } from "@/features/bookings/messages/booking-messages.repository";
import ForbiddenError from "@/errors/http/forbidden.error";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { testUuid } from "../../../support/uuid";
const BOOKING_1_ID = testUuid(9200, 996753);
const BOOKING_2_ID = testUuid(9200, 996754);
const MESSAGE_1_ID = testUuid(9200, 597033);
const ORG_1_ID = testUuid(9200, 9234);
const USER_1_ID = testUuid(9200, 994257);

const RENTER_1_ID = testUuid(9000, 235000);

const INPUT = {
  bookingRequestId: BOOKING_1_ID,
  recipientId: USER_1_ID,
  messageId: MESSAGE_1_ID,
};

function createMessageContext(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_1_ID,
    bookingRequestId: BOOKING_1_ID,
    authorId: RENTER_1_ID,
    body: "Is the van available early?",
    createdAt: new Date("2026-08-10T12:00:00.000Z"),
    readAt: null,
    bookingRequest: {
      id: BOOKING_1_ID,
      renterId: RENTER_1_ID,
      organizationId: ORG_1_ID,
      posting: { name: "Cargo van" },
    },
    author: { firstName: "Jordan", lastName: "Lee" },
    ...overrides,
  } as any;
}

function createComposer(
  options: {
    message?: unknown;
    recipient?: unknown;
    membershipError?: Error;
  } = {},
) {
  const bookingMessagesRepository = {
    findByIdWithContext: jest.fn(async () =>
      options.message === undefined ? createMessageContext() : options.message,
    ),
  } as unknown as BookingMessagesRepository;

  const organizationAccessService = {
    requireMembership: jest.fn(async () => {
      if (options.membershipError) {
        throw options.membershipError;
      }

      return { organizationId: ORG_1_ID, role: "primary_manager" };
    }),
    canManage: jest.fn(() => true),
  } as unknown as OrganizationAccessService;

  const authRepository = {
    findUserById: jest.fn(async () =>
      options.recipient === undefined
        ? { id: USER_1_ID, email: "owner@example.com", firstName: "Ada" }
        : options.recipient,
    ),
  } as unknown as UsersRepository;

  return {
    composer: new BookingMessageEmailComposer(
      bookingMessagesRepository,
      authRepository,
      organizationAccessService,
    ),
    bookingMessagesRepository,
    authRepository,
  };
}

describe("BookingMessageEmailComposer", () => {
  it("hydrates the email content from the job ids", async () => {
    const { composer } = createComposer();

    await expect(composer.compose(INPUT)).resolves.toEqual({
      to: "owner@example.com",
      firstName: "Ada",
      postingName: "Cargo van",
      authorName: "Jordan Lee",
      snippet: "Is the van available early?",
      bookingRequestId: BOOKING_1_ID,
    });
  });

  it("returns null when the message no longer exists", async () => {
    const { composer } = createComposer({ message: null });

    await expect(composer.compose(INPUT)).resolves.toBeNull();
  });

  it("returns null when the message belongs to another booking", async () => {
    const { composer } = createComposer({
      message: createMessageContext({ bookingRequestId: BOOKING_2_ID }),
    });

    await expect(composer.compose(INPUT)).resolves.toBeNull();
  });

  it("returns null when the recipient is no longer a party to the booking", async () => {
    const { composer, authRepository } = createComposer({
      membershipError: new ForbiddenError("No access."),
    });

    // The recipient was the organization's primary manager when the message was
    // written. If they were removed before the worker ran, this email would
    // carry a snippet of a conversation they can no longer read.
    await expect(composer.compose(INPUT)).resolves.toBeNull();
    expect(authRepository.findUserById).not.toHaveBeenCalled();
  });

  it("still notifies the renter, who is a party by definition", async () => {
    const { composer } = createComposer({
      membershipError: new ForbiddenError("No access."),
    });

    // The renter is resolved from the booking's own `renterId`, so the
    // membership lookup is never reached for them.
    await expect(
      composer.compose({ ...INPUT, recipientId: RENTER_1_ID }),
    ).resolves.toMatchObject({ to: "owner@example.com" });
  });

  it("returns null when the author deleted the message before delivery", async () => {
    const { composer } = createComposer({
      message: createMessageContext({
        body: "",
        deletedAt: new Date("2026-08-10T12:05:00.000Z"),
      }),
    });

    // A soft delete clears the body but keeps the row, so a job that waited
    // behind a backlog would otherwise send a "new message" email with an empty
    // snippet. Null makes the worker acknowledge without sending.
    await expect(composer.compose(INPUT)).resolves.toBeNull();
  });

  it("returns null when the recipient no longer exists", async () => {
    const { composer } = createComposer({ recipient: null });

    await expect(composer.compose(INPUT)).resolves.toBeNull();
  });

  it("omits the greeting name when the recipient has none", async () => {
    const { composer } = createComposer({
      recipient: { id: USER_1_ID, email: "owner@example.com" },
    });

    await expect(composer.compose(INPUT)).resolves.toMatchObject({
      to: "owner@example.com",
    });
    await expect(composer.compose(INPUT)).resolves.not.toHaveProperty(
      "firstName",
    );
  });

  it("falls back to a generic author name when the author is unnamed", async () => {
    const { composer } = createComposer({
      message: createMessageContext({
        author: { firstName: null, lastName: null },
      }),
    });

    await expect(composer.compose(INPUT)).resolves.toMatchObject({
      authorName: "Someone",
    });
  });

  it("truncates a long body into a snippet", async () => {
    const { composer } = createComposer({
      message: createMessageContext({ body: "x".repeat(300) }),
    });

    const content = await composer.compose(INPUT);

    expect(content?.snippet).toHaveLength(141);
    expect(content?.snippet.endsWith("…")).toBe(true);
  });
});
