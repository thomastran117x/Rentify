import type { AuthRepository } from "@/features/auth/auth.repository";
import { BookingMessageEmailComposer } from "@/features/bookings/messages/booking-message-email.composer";
import type { BookingMessagesRepository } from "@/features/bookings/messages/booking-messages.repository";

const INPUT = {
  bookingRequestId: "booking-1",
  recipientId: "user-1",
  messageId: "message-1",
};

function createMessageContext(overrides: Record<string, unknown> = {}) {
  return {
    id: "message-1",
    bookingRequestId: "booking-1",
    authorId: "renter-1",
    body: "Is the van available early?",
    createdAt: new Date("2026-08-10T12:00:00.000Z"),
    readAt: null,
    bookingRequest: {
      id: "booking-1",
      renterId: "renter-1",
      organizationId: "org-1",
      posting: { name: "Cargo van" },
    },
    author: { firstName: "Jordan", lastName: "Lee" },
    ...overrides,
  } as any;
}

function createComposer(options: {
  message?: unknown;
  recipient?: unknown;
} = {}) {
  const bookingMessagesRepository = {
    findByIdWithContext: jest.fn(async () =>
      options.message === undefined ? createMessageContext() : options.message,
    ),
  } as unknown as BookingMessagesRepository;

  const authRepository = {
    findUserById: jest.fn(async () =>
      options.recipient === undefined
        ? { id: "user-1", email: "owner@example.com", firstName: "Ada" }
        : options.recipient,
    ),
  } as unknown as AuthRepository;

  return {
    composer: new BookingMessageEmailComposer(
      bookingMessagesRepository,
      authRepository,
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
      bookingRequestId: "booking-1",
    });
  });

  it("returns null when the message no longer exists", async () => {
    const { composer } = createComposer({ message: null });

    await expect(composer.compose(INPUT)).resolves.toBeNull();
  });

  it("returns null when the message belongs to another booking", async () => {
    const { composer } = createComposer({
      message: createMessageContext({ bookingRequestId: "booking-2" }),
    });

    await expect(composer.compose(INPUT)).resolves.toBeNull();
  });

  it("returns null when the recipient no longer exists", async () => {
    const { composer } = createComposer({ recipient: null });

    await expect(composer.compose(INPUT)).resolves.toBeNull();
  });

  it("omits the greeting name when the recipient has none", async () => {
    const { composer } = createComposer({
      recipient: { id: "user-1", email: "owner@example.com" },
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
