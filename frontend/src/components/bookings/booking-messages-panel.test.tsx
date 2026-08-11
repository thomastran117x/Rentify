import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  listMock,
  sendMock,
  markReadMock,
  openStreamMock,
  closeMock,
  editMock,
  removeMock,
  sendTypingMock,
  sendDeliveredMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  sendMock: vi.fn(),
  markReadMock: vi.fn(),
  openStreamMock: vi.fn(),
  closeMock: vi.fn(),
  editMock: vi.fn(),
  removeMock: vi.fn(),
  sendTypingMock: vi.fn(),
  sendDeliveredMock: vi.fn(),
}));

vi.mock("@/lib/booking-messages/api", () => ({
  bookingMessagesApi: {
    list: listMock,
    send: sendMock,
    markRead: markReadMock,
    edit: editMock,
    remove: removeMock,
  },
}));

vi.mock("@/lib/booking-messages/socket", () => ({
  openBookingMessageSocket: openStreamMock,
}));

const { BookingMessagesPanel } = await import(
  "@/components/bookings/booking-messages-panel"
);

const CURRENT_USER_ID = "renter-1";

function buildMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "message-1",
    bookingRequestId: "booking-1",
    authorId: CURRENT_USER_ID,
    authorSide: "renter" as const,
    body: "Is an early pickup possible?",
    createdAt: "2026-08-10T12:00:00.000Z",
    readAt: null,
    deliveredAt: null,
    authorUsername: "renter-one",
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function buildList(overrides: Record<string, unknown> = {}) {
  return {
    messages: [buildMessage()],
    pagination: {
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    unreadCount: 0,
    canWrite: true,
    counterpartName: "Maya Santos Organization",
    viewerSide: "renter" as const,
    ...overrides,
  };
}

/** Captures the stream callbacks so tests can push events synchronously. */
function captureStreamHandlers() {
  return openStreamMock.mock.calls[0][0] as {
    onEvent: (event: unknown) => void;
    onStatus: (status: string) => void;
  };
}

function renderPanel() {
  return render(
    <BookingMessagesPanel
      bookingRequestId="booking-1"
      currentUserId={CURRENT_USER_ID}
    />,
  );
}

describe("BookingMessagesPanel", () => {
  beforeEach(() => {
    listMock.mockReset();
    sendMock.mockReset();
    markReadMock.mockReset();
    openStreamMock.mockReset();
    closeMock.mockReset();

    listMock.mockResolvedValue(buildList());
    markReadMock.mockResolvedValue({
      bookingRequestId: "booking-1",
      markedCount: 0,
      readAt: "2026-08-10T12:05:00.000Z",
    });
    openStreamMock.mockReturnValue({
      close: closeMock,
      sendTyping: sendTypingMock,
      sendDelivered: sendDeliveredMock,
    });
    editMock.mockReset();
    removeMock.mockReset();
    sendTypingMock.mockReset();
    sendDeliveredMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the thread and aligns the current user's messages", async () => {
    listMock.mockResolvedValue(
      buildList({
        messages: [
          buildMessage(),
          buildMessage({
            id: "message-2",
            authorId: "owner-9",
            authorSide: "owner",
            body: "Yes, from 9am.",
          }),
        ],
      }),
    );

    renderPanel();

    await screen.findByText("Is an early pickup possible?");
    const bubbles = screen.getAllByTestId("booking-message");

    // Rendered oldest-first, so the reply the API returned first appears last.
    expect(bubbles[0]).toHaveTextContent("Yes, from 9am.");
    expect(bubbles[0]).toHaveAttribute("data-mine", "false");
    expect(bubbles[1]).toHaveTextContent("Is an early pickup possible?");
    expect(bubbles[1]).toHaveAttribute("data-mine", "true");
  });

  it("renders the thread oldest to newest", async () => {
    listMock.mockResolvedValue(
      buildList({
        messages: [
          // The API returns newest-first.
          buildMessage({
            id: "third",
            body: "Third",
            createdAt: "2026-08-10T12:20:00.000Z",
          }),
          buildMessage({
            id: "second",
            body: "Second",
            createdAt: "2026-08-10T12:10:00.000Z",
          }),
          buildMessage({
            id: "first",
            body: "First",
            createdAt: "2026-08-10T12:00:00.000Z",
          }),
        ],
      }),
    );

    renderPanel();
    await screen.findByText("First");

    expect(
      screen
        .getAllByTestId("booking-message")
        .map((bubble) => bubble.querySelector("p")?.textContent),
    ).toEqual(["First", "Second", "Third"]);
  });

  it("shows an empty state when there are no messages", async () => {
    listMock.mockResolvedValue(buildList({ messages: [] }));

    renderPanel();

    expect(await screen.findByText(/no messages yet/i)).toBeInTheDocument();
  });

  it("shows the unread badge", async () => {
    listMock.mockResolvedValue(buildList({ unreadCount: 3 }));

    renderPanel();

    expect(await screen.findByText("3 unread")).toBeInTheDocument();
  });

  it("marks the thread read on mount", async () => {
    renderPanel();

    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith("booking-1"));
  });

  it("marks the thread read again on window focus", async () => {
    renderPanel();

    await waitFor(() => expect(markReadMock).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(markReadMock).toHaveBeenCalledTimes(2));
  });

  it("sends a message and clears the composer", async () => {
    const user = userEvent.setup();
    sendMock.mockResolvedValue(
      buildMessage({ id: "message-new", body: "Hello there" }),
    );

    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    const textarea = screen.getByLabelText("Message");
    await user.type(textarea, "Hello there");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() =>
      expect(sendMock).toHaveBeenCalledWith("booking-1", {
        body: "Hello there",
      }),
    );
    expect(textarea).toHaveValue("");
    expect(await screen.findByText("Hello there")).toBeInTheDocument();
  });

  it("keeps the send button disabled for an empty or whitespace body", async () => {
    const user = userEvent.setup();

    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    const sendButton = screen.getByRole("button", { name: /send/i });
    expect(sendButton).toBeDisabled();

    await user.type(screen.getByLabelText("Message"), "   ");
    expect(sendButton).toBeDisabled();
  });

  it("disables sending past the maximum length and shows the counter", async () => {
    const user = userEvent.setup();

    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    const textarea = screen.getByLabelText("Message");
    await user.click(textarea);
    await user.paste("x".repeat(2001));

    expect(screen.getByText("2001 / 2000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("surfaces a send failure without clearing the composer", async () => {
    const user = userEvent.setup();
    sendMock.mockRejectedValue(new Error("nope"));

    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    const textarea = screen.getByLabelText("Message");
    await user.type(textarea, "Hello there");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(textarea).toHaveValue("Hello there");
  });

  it("appends a streamed message", async () => {
    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    captureStreamHandlers().onEvent({
      type: "message.created",
      bookingRequestId: "booking-1",
      message: buildMessage({
        id: "message-streamed",
        authorId: "owner-9",
        authorSide: "owner",
        body: "Streamed reply",
      }),
    });

    expect(await screen.findByText("Streamed reply")).toBeInTheDocument();
  });

  it("does not duplicate a message delivered twice", async () => {
    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    const event = {
      type: "message.created" as const,
      bookingRequestId: "booking-1",
      message: buildMessage({
        id: "message-streamed",
        authorId: "owner-9",
        authorSide: "owner",
        body: "Streamed reply",
      }),
    };

    const handlers = captureStreamHandlers();
    handlers.onEvent(event);
    handlers.onEvent(event);

    await screen.findByText("Streamed reply");
    expect(screen.getAllByText("Streamed reply")).toHaveLength(1);
  });

  it("ignores a read event from the message author's own side", async () => {
    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    // The current user is the renter, so a renter-side read event marks the
    // owner's messages — never the renter's own.
    captureStreamHandlers().onEvent({
      type: "messages.read",
      bookingRequestId: "booking-1",
      readerSide: "renter",
      readAt: "2026-08-10T12:10:00.000Z",
      markedCount: 1,
    });

    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(screen.queryByText(/^Read /)).not.toBeInTheDocument();
  });

  it("flips the seen indicator on a read event", async () => {
    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    expect(screen.queryByText(/^Read /)).not.toBeInTheDocument();

    captureStreamHandlers().onEvent({
      type: "messages.read",
      bookingRequestId: "booking-1",
      readerSide: "owner",
      readAt: "2026-08-10T12:10:00.000Z",
      markedCount: 1,
    });

    expect(await screen.findByText(/^Read /)).toBeInTheDocument();
  });

  it("re-syncs the history whenever the stream opens", async () => {
    renderPanel();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    captureStreamHandlers().onStatus("open");

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it("shows the offline notice and polls once the stream fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderPanel();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    captureStreamHandlers().onStatus("failed");

    expect(
      await screen.findByText(/live updates unavailable/i),
    ).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(15_000);

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it("aligns by participant side, not author id", async () => {
    // The viewer is an organization manager; a colleague manager's message has
    // a different authorId but is still outgoing for this side.
    listMock.mockResolvedValue(
      buildList({
        viewerSide: "owner",
        messages: [
          buildMessage({
            id: "from-colleague",
            authorId: "manager-other",
            authorSide: "owner",
            body: "Colleague reply",
          }),
          buildMessage({
            id: "from-renter",
            authorId: "renter-9",
            authorSide: "renter",
            body: "Renter question",
          }),
        ],
      }),
    );

    renderPanel();
    await screen.findByText("Colleague reply");

    const bubbles = screen.getAllByTestId("booking-message");
    expect(bubbles[0]).toHaveTextContent("Renter question");
    expect(bubbles[0]).toHaveAttribute("data-mine", "false");
    expect(bubbles[1]).toHaveTextContent("Colleague reply");
    expect(bubbles[1]).toHaveAttribute("data-mine", "true");
  });

  it("keeps a message that arrives while a history request is in flight", async () => {
    let resolveList: (value: unknown) => void = () => {};
    listMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    renderPanel();

    await waitFor(() => expect(openStreamMock).toHaveBeenCalled());

    // Delivered after the request was issued but before its response lands.
    captureStreamHandlers().onEvent({
      type: "message.created",
      bookingRequestId: "booking-1",
      message: buildMessage({
        id: "raced-message",
        authorId: "owner-9",
        authorSide: "owner",
        body: "Raced message",
      }),
    });

    // The response is a snapshot taken before that insert.
    resolveList(buildList());

    expect(await screen.findByText("Raced message")).toBeInTheDocument();
    // The list response is a pre-insert snapshot; both must survive the merge.
    expect(
      await screen.findByText("Is an early pickup possible?"),
    ).toBeInTheDocument();
  });

  it("keeps pagination totals honest when a message is inserted live", async () => {
    listMock.mockResolvedValue(
      buildList({
        pagination: {
          page: 1,
          pageSize: 20,
          total: 40,
          totalPages: 2,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      }),
    );

    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    captureStreamHandlers().onEvent({
      type: "message.created",
      bookingRequestId: "booking-1",
      message: buildMessage({ id: "message-41", body: "Forty first" }),
    });

    // 41 messages at 20 per page is three pages; leaving it at two makes the
    // oldest message unreachable.
    expect(await screen.findByText("Forty first")).toBeInTheDocument();
    // A third page control must appear, otherwise the oldest message sits on a
    // page the user cannot navigate to.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "3" })).toBeInTheDocument(),
    );
    expect(
      screen.getAllByText(
        (_, element) =>
          element?.tagName === "P" &&
          (element.textContent ?? "").includes("of 41 messages"),
      ),
    ).toHaveLength(1);
  });

  it("shows the read time only on the newest message this side sent", async () => {
    listMock.mockResolvedValue(
      buildList({
        messages: [
          // Newest first.
          buildMessage({
            id: "newest-sent",
            body: "Newest sent",
            createdAt: "2026-08-10T12:10:00.000Z",
            readAt: "2026-08-10T12:20:00.000Z",
          }),
          buildMessage({
            id: "incoming",
            body: "Their reply",
            authorId: "owner-9",
            authorSide: "owner",
            createdAt: "2026-08-10T12:05:00.000Z",
            readAt: "2026-08-10T12:06:00.000Z",
          }),
          buildMessage({
            id: "older-sent",
            body: "Older sent",
            createdAt: "2026-08-10T12:00:00.000Z",
            readAt: "2026-08-10T12:20:00.000Z",
          }),
        ],
      }),
    );

    renderPanel();
    await screen.findByText("Newest sent");

    // Exactly one receipt, on the newest message this side sent — never on an
    // earlier one, and never on a message the other side wrote.
    const receipts = screen.getAllByText(/^Read /);
    expect(receipts).toHaveLength(1);

    // Oldest-first: the newest sent message is last.
    const bubbles = screen.getAllByTestId("booking-message");
    expect(bubbles[2]).toHaveTextContent("Newest sent");
    expect(bubbles[2]).toHaveTextContent(/Read /);
    expect(bubbles[0]).not.toHaveTextContent(/Read /);
    expect(bubbles[1]).not.toHaveTextContent(/Read /);
  });

  it("shows no receipt while the newest sent message is unread", async () => {
    listMock.mockResolvedValue(
      buildList({
        messages: [
          buildMessage({
            id: "newest-sent",
            body: "Newest sent",
            createdAt: "2026-08-10T12:10:00.000Z",
            readAt: null,
          }),
          buildMessage({
            id: "older-sent",
            body: "Older sent",
            createdAt: "2026-08-10T12:00:00.000Z",
            readAt: "2026-08-10T12:05:00.000Z",
          }),
        ],
      }),
    );

    renderPanel();
    await screen.findByText("Newest sent");

    expect(screen.queryByText(/^Read /)).not.toBeInTheDocument();
  });

  it("does not attach the receipt on an older page", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(
      buildList({
        messages: [
          buildMessage({
            id: "sent",
            body: "Sent",
            readAt: "2026-08-10T12:20:00.000Z",
          }),
        ],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 40,
          totalPages: 2,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      }),
    );

    renderPanel();
    await screen.findByText("Sent");
    expect(screen.getByText(/^Read /)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2" }));

    // Page 2 cannot hold the newest sent message, so a receipt there would be
    // pinned to a stale one.
    await waitFor(() =>
      expect(screen.queryByText(/^Read /)).not.toBeInTheDocument(),
    );
  });

  it("does not insert a live message into an older page", async () => {
    const user = userEvent.setup();
    const pageTwo = Array.from({ length: 20 }, (_, index) =>
      buildMessage({ id: `older-${index}`, body: `Older ${index}` }),
    );
    listMock.mockImplementation(async (_id: string, input: { page: number }) =>
      buildList({
        messages:
          input.page === 1
            ? [buildMessage({ id: "newest", body: "Newest" })]
            : pageTwo,
        pagination: {
          page: input.page,
          pageSize: 20,
          total: 40,
          totalPages: 2,
          hasNextPage: input.page < 2,
          hasPreviousPage: input.page > 1,
        },
      }),
    );

    renderPanel();
    await screen.findByText("Newest");
    await user.click(screen.getByRole("button", { name: "2" }));
    await screen.findByText("Older 0");

    captureStreamHandlers().onEvent({
      type: "message.created",
      bookingRequestId: "booking-1",
      message: buildMessage({ id: "streamed", body: "Streamed while paging" }),
    });

    // Newest-first paging places it on page 1; showing it here would also push
    // a row that does belong on this page off the end.
    await waitFor(() =>
      expect(screen.getAllByTestId("booking-message")).toHaveLength(20),
    );
    expect(screen.queryByText("Streamed while paging")).not.toBeInTheDocument();
    expect(screen.getByText("Older 19")).toBeInTheDocument();
  });

  it("caps the page at the page size when a race is merged in", async () => {
    let resolveList: (value: unknown) => void = () => {};
    const fullPage = Array.from({ length: 20 }, (_, index) =>
      buildMessage({ id: `server-${index}`, body: `Server ${index}` }),
    );
    listMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    renderPanel();
    await waitFor(() => expect(openStreamMock).toHaveBeenCalled());

    captureStreamHandlers().onEvent({
      type: "message.created",
      bookingRequestId: "booking-1",
      message: buildMessage({ id: "raced", body: "Raced in" }),
    });

    resolveList(
      buildList({
        messages: fullPage,
        pagination: {
          page: 1,
          pageSize: 20,
          total: 40,
          totalPages: 2,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      }),
    );

    expect(await screen.findByText("Raced in")).toBeInTheDocument();
    // 21 rows would hand the displaced row back at the top of page 2.
    await waitFor(() =>
      expect(screen.getAllByTestId("booking-message")).toHaveLength(20),
    );
    expect(screen.queryByText("Server 19")).not.toBeInTheDocument();
  });

  it("trims page one back to the page size after a live insert", async () => {
    const fullPage = Array.from({ length: 20 }, (_, index) =>
      buildMessage({
        id: `message-${index}`,
        body: `Message ${index}`,
        createdAt: `2026-08-10T12:${String(index).padStart(2, "0")}:00.000Z`,
      }),
    );
    listMock.mockResolvedValue(
      buildList({
        messages: fullPage,
        pagination: {
          page: 1,
          pageSize: 20,
          total: 40,
          totalPages: 2,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      }),
    );

    renderPanel();
    await screen.findByText("Message 0");

    captureStreamHandlers().onEvent({
      type: "message.created",
      bookingRequestId: "booking-1",
      message: buildMessage({ id: "message-new", body: "Newest" }),
    });

    expect(await screen.findByText("Newest")).toBeInTheDocument();
    // A 21st row would leave the server returning the last row again at the
    // top of page 2, showing it on both pages.
    await waitFor(() =>
      expect(screen.getAllByTestId("booking-message")).toHaveLength(20),
    );
    expect(screen.queryByText("Message 19")).not.toBeInTheDocument();
  });

  it("does not mark a message created after the read cutoff as seen", async () => {
    listMock.mockResolvedValue(
      buildList({
        messages: [
          buildMessage({
            id: "before-cutoff",
            body: "Before cutoff",
            authorId: "manager-1",
            authorSide: "owner",
            createdAt: "2026-08-10T12:00:00.000Z",
          }),
        ],
        viewerSide: "owner",
      }),
    );

    renderPanel();
    await screen.findByText("Before cutoff");

    // Arrives ahead of the read event it raced, so the update never covered it.
    captureStreamHandlers().onEvent({
      type: "message.created",
      bookingRequestId: "booking-1",
      message: buildMessage({
        id: "after-cutoff",
        body: "After cutoff",
        authorId: "manager-1",
        authorSide: "owner",
        createdAt: "2026-08-10T12:10:00.000Z",
      }),
    });
    await screen.findByText("After cutoff");

    captureStreamHandlers().onEvent({
      type: "messages.read",
      bookingRequestId: "booking-1",
      readerSide: "renter",
      readAt: "2026-08-10T12:05:00.000Z",
      markedCount: 1,
    });

    // The receipt sits on the newest sent message, which this read did not
    // cover, so nothing is claimed as read.
    await waitFor(() => expect(markReadMock).toHaveBeenCalled());
    expect(screen.queryByText(/^Read /)).not.toBeInTheDocument();

    // A later read does cover it, proving the cutoff gates the update rather
    // than suppressing it outright.
    captureStreamHandlers().onEvent({
      type: "messages.read",
      bookingRequestId: "booking-1",
      readerSide: "renter",
      readAt: "2026-08-10T12:15:00.000Z",
      markedCount: 1,
    });

    expect(await screen.findByText(/^Read /)).toBeInTheDocument();
  });

  it("does not mark read for a message from the viewer's own side", async () => {
    listMock.mockResolvedValue(buildList({ viewerSide: "owner" }));

    renderPanel();
    await screen.findByText("Is an early pickup possible?");
    await waitFor(() => expect(markReadMock).toHaveBeenCalledTimes(1));

    captureStreamHandlers().onEvent({
      type: "message.created",
      bookingRequestId: "booking-1",
      message: buildMessage({
        id: "from-colleague",
        authorId: "manager-other",
        authorSide: "owner",
        body: "Colleague reply",
      }),
    });

    await screen.findByText("Colleague reply");
    // A colleague on the same side has not written to this viewer.
    expect(markReadMock).toHaveBeenCalledTimes(1);
  });

  it("names who the viewer is talking to", async () => {
    renderPanel();

    expect(
      await screen.findByText("with Maya Santos Organization"),
    ).toBeInTheDocument();
  });

  it("labels each message with its author", async () => {
    listMock.mockResolvedValue(
      buildList({
        messages: [
          buildMessage({
            id: "from-manager",
            authorId: "manager-9",
            authorSide: "owner",
            authorUsername: "owner-one",
            body: "Manager reply",
          }),
        ],
      }),
    );

    renderPanel();

    expect(await screen.findByText("owner-one")).toBeInTheDocument();
  });

  it("renders a tombstone for a deleted message", async () => {
    listMock.mockResolvedValue(
      buildList({
        messages: [
          buildMessage({
            id: "gone",
            body: "",
            deletedAt: "2026-08-10T12:30:00.000Z",
          }),
        ],
      }),
    );

    renderPanel();

    expect(await screen.findByText("Message deleted")).toBeInTheDocument();
    // No controls on a message that is already gone.
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });

  it("marks an edited message", async () => {
    listMock.mockResolvedValue(
      buildList({
        messages: [buildMessage({ editedAt: "2026-08-10T12:30:00.000Z" })],
      }),
    );

    renderPanel();

    expect(await screen.findByText("· edited")).toBeInTheDocument();
  });

  it("edits the viewer's own recent message", async () => {
    const user = userEvent.setup();
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValue("Corrected text");
    listMock.mockResolvedValue(
      buildList({
        messages: [buildMessage({ createdAt: new Date().toISOString() })],
      }),
    );
    editMock.mockResolvedValue(
      buildMessage({
        body: "Corrected text",
        editedAt: "2026-08-10T12:30:00.000Z",
      }),
    );

    renderPanel();
    await screen.findByText("Is an early pickup possible?");
    await user.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() =>
      expect(editMock).toHaveBeenCalledWith("booking-1", "message-1", {
        body: "Corrected text",
      }),
    );
    expect(await screen.findByText("Corrected text")).toBeInTheDocument();

    promptSpy.mockRestore();
  });

  it("deletes the viewer's own recent message after confirming", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    listMock.mockResolvedValue(
      buildList({
        messages: [buildMessage({ createdAt: new Date().toISOString() })],
      }),
    );
    removeMock.mockResolvedValue(
      buildMessage({ body: "", deletedAt: "2026-08-10T12:40:00.000Z" }),
    );

    renderPanel();
    await screen.findByText("Is an early pickup possible?");
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(removeMock).toHaveBeenCalledWith("booking-1", "message-1"),
    );
    expect(await screen.findByText("Message deleted")).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("hides the controls once the edit window has passed", async () => {
    listMock.mockResolvedValue(
      buildList({
        messages: [
          buildMessage({
            createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
          }),
        ],
      }),
    );

    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    // The API would reject the change, so the control must not be offered.
    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("does not offer controls on another user's message", async () => {
    listMock.mockResolvedValue(
      buildList({
        messages: [
          buildMessage({
            id: "theirs",
            authorId: "owner-9",
            authorSide: "owner",
            createdAt: new Date().toISOString(),
          }),
        ],
      }),
    );

    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("applies a streamed update in place", async () => {
    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    captureStreamHandlers().onEvent({
      type: "message.updated",
      bookingRequestId: "booking-1",
      message: buildMessage({
        body: "",
        deletedAt: "2026-08-10T12:40:00.000Z",
      }),
    });

    expect(await screen.findByText("Message deleted")).toBeInTheDocument();
    expect(screen.getAllByTestId("booking-message")).toHaveLength(1);
  });

  it("opens exactly one stream connection per mount", async () => {
    renderPanel();

    await waitFor(() => expect(listMock).toHaveBeenCalled());
    // The first response changes canWrite and viewerSide; the effect must not
    // tear the connection down and reopen it when they land.
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeTruthy());

    expect(openStreamMock).toHaveBeenCalledTimes(1);
  });

  it("returns to the newest page after sending from an older page", async () => {
    const user = userEvent.setup();
    listMock.mockImplementation(async (_id: string, input: { page: number }) =>
      buildList({
        messages: [
          buildMessage({
            id: `page-${input.page}`,
            body: `Page ${input.page} message`,
          }),
        ],
        pagination: {
          page: input.page,
          pageSize: 20,
          total: 40,
          totalPages: 2,
          hasNextPage: input.page < 2,
          hasPreviousPage: input.page > 1,
        },
      }),
    );
    sendMock.mockResolvedValue(buildMessage({ id: "sent", body: "Sent it" }));

    renderPanel();
    await screen.findByText("Page 1 message");
    await user.click(screen.getByRole("button", { name: "2" }));
    await screen.findByText("Page 2 message");

    await user.type(screen.getByLabelText("Message"), "Sent it");
    await user.click(screen.getByRole("button", { name: /send/i }));

    // Otherwise the message is persisted but never shown, with no feedback.
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith("booking-1", {
        page: 1,
        pageSize: 20,
      }),
    );
  });

  it("does not resurrect a cleared unread badge on a silent re-sync", async () => {
    listMock.mockResolvedValue(buildList({ unreadCount: 2 }));
    markReadMock.mockResolvedValue({
      bookingRequestId: "booking-1",
      markedCount: 2,
      readAt: "2026-08-10T12:05:00.000Z",
    });

    renderPanel();
    await screen.findByText("Is an early pickup possible?");
    await waitFor(() =>
      expect(screen.queryByText("2 unread")).not.toBeInTheDocument(),
    );

    // A pre-markRead snapshot arriving late must not bring the badge back.
    captureStreamHandlers().onStatus("open");

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("2 unread")).not.toBeInTheDocument();
  });

  it("keeps a streamed update that raced a history response", async () => {
    let resolveList: (value: unknown) => void = () => {};
    listMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    renderPanel();
    await waitFor(() => expect(openStreamMock).toHaveBeenCalled());

    captureStreamHandlers().onEvent({
      type: "message.updated",
      bookingRequestId: "booking-1",
      message: buildMessage({
        body: "",
        deletedAt: "2026-08-10T12:40:00.000Z",
      }),
    });

    // The response is a pre-delete snapshot.
    resolveList(buildList());

    expect(await screen.findByText("Message deleted")).toBeInTheDocument();
    expect(
      screen.queryByText("Is an early pickup possible?"),
    ).not.toBeInTheDocument();
  });

  it("cancels an edit cleared to an empty body", async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("   ");
    listMock.mockResolvedValue(
      buildList({
        messages: [buildMessage({ createdAt: new Date().toISOString() })],
      }),
    );

    renderPanel();
    await screen.findByText("Is an early pickup possible?");
    await user.click(screen.getByRole("button", { name: "Edit" }));

    // The API rejects an empty body; treat clearing the prompt as a cancel.
    expect(editMock).not.toHaveBeenCalled();

    promptSpy.mockRestore();
  });

  it("never shows a read receipt on a deleted message", async () => {
    listMock.mockResolvedValue(
      buildList({
        messages: [
          buildMessage({
            id: "gone",
            body: "",
            readAt: "2026-08-10T12:20:00.000Z",
            deletedAt: "2026-08-10T12:30:00.000Z",
          }),
        ],
      }),
    );

    renderPanel();
    await screen.findByText("Message deleted");

    expect(screen.queryByText(/^Read /)).not.toBeInTheDocument();
  });

  it("shows a typing indicator from the other side and lets it expire", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    captureStreamHandlers().onEvent({
      type: "typing",
      bookingRequestId: "booking-1",
      side: "owner",
      username: "owner-one",
      expiresAt: new Date(Date.now() + 6_000).toISOString(),
    });

    expect(await screen.findByText(/owner-one is typing/i)).toBeInTheDocument();

    // Self-expiring: no "stopped typing" frame is required.
    await vi.advanceTimersByTimeAsync(6_500);
    await waitFor(() =>
      expect(screen.queryByText(/is typing/i)).not.toBeInTheDocument(),
    );
  });

  it("extends the typing indicator when a later frame arrives", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    const typingFrame = () => ({
      type: "typing" as const,
      bookingRequestId: "booking-1",
      side: "owner" as const,
      username: "owner-one",
      expiresAt: new Date(Date.now() + 6_000).toISOString(),
    });

    captureStreamHandlers().onEvent(typingFrame());
    await screen.findByText(/owner-one is typing/i);

    await vi.advanceTimersByTimeAsync(3_000);
    captureStreamHandlers().onEvent(typingFrame());

    // The first frame's expiry lands here. A per-frame timer would hide the
    // indicator even though the refresh extended it to t=9s.
    await vi.advanceTimersByTimeAsync(3_500);
    expect(screen.getByText(/owner-one is typing/i)).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(3_000);
    await waitFor(() =>
      expect(screen.queryByText(/is typing/i)).not.toBeInTheDocument(),
    );
  });

  it("ignores a typing echo from the viewer's own side", async () => {
    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    captureStreamHandlers().onEvent({
      type: "typing",
      bookingRequestId: "booking-1",
      side: "renter",
      username: "renter-one",
      expiresAt: new Date(Date.now() + 6_000).toISOString(),
    });

    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(screen.queryByText(/is typing/i)).not.toBeInTheDocument();
  });

  it("reflects the counterpart's presence", async () => {
    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    expect(screen.getByTestId("counterpart-presence")).toHaveAttribute(
      "data-online",
      "false",
    );

    captureStreamHandlers().onEvent({
      type: "presence",
      bookingRequestId: "booking-1",
      side: "owner",
      username: "owner-one",
      state: "online",
    });

    await waitFor(() =>
      expect(screen.getByTestId("counterpart-presence")).toHaveAttribute(
        "data-online",
        "true",
      ),
    );
  });

  it("acknowledges delivery of the other side's messages only", async () => {
    listMock.mockResolvedValue(
      buildList({
        messages: [
          buildMessage({
            id: "theirs",
            authorId: "owner-9",
            authorSide: "owner",
            body: "From the owner",
          }),
          buildMessage({ id: "mine", body: "From me" }),
        ],
      }),
    );

    renderPanel();
    await screen.findByText("From the owner");

    // Only the other side's messages are acknowledged; our own are not.
    await waitFor(() =>
      expect(sendDeliveredMock).toHaveBeenCalledWith(["theirs"]),
    );
  });

  it("marks messages delivered from a socket frame", async () => {
    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    captureStreamHandlers().onEvent({
      type: "messages.delivered",
      bookingRequestId: "booking-1",
      messageIds: ["message-1"],
      deliveredAt: "2026-08-10T12:30:00.000Z",
    });

    // Delivery must not be confused with a read receipt.
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(screen.queryByText(/^Read /)).not.toBeInTheDocument();
  });

  it("announces typing as the composer is used", async () => {
    const user = userEvent.setup();

    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    await user.type(screen.getByLabelText("Message"), "Hi");

    expect(sendTypingMock).toHaveBeenCalled();
  });

  it("closes the stream on unmount", async () => {
    const { unmount } = renderPanel();
    await screen.findByText("Is an early pickup possible?");

    unmount();

    expect(closeMock).toHaveBeenCalled();
  });

  it("renders a read-only notice instead of the composer for viewers who cannot write", async () => {
    listMock.mockResolvedValue(buildList({ canWrite: false }));
    renderPanel();

    await screen.findByText("Is an early pickup possible?");

    expect(screen.getByText(/read-only access/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /send/i }),
    ).not.toBeInTheDocument();
  });

  it("never calls mark-read for a read-only viewer", async () => {
    listMock.mockResolvedValue(buildList({ canWrite: false }));
    renderPanel();

    await screen.findByText("Is an early pickup possible?");
    window.dispatchEvent(new Event("focus"));

    // Mark-read requires the same permission as sending; firing it would 403.
    expect(markReadMock).not.toHaveBeenCalled();
  });

  it("surfaces a load failure", async () => {
    listMock.mockRejectedValue(new Error("boom"));

    renderPanel();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
