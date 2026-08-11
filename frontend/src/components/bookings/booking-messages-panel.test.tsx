import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, sendMock, markReadMock, openStreamMock, closeMock } =
  vi.hoisted(() => ({
    listMock: vi.fn(),
    sendMock: vi.fn(),
    markReadMock: vi.fn(),
    openStreamMock: vi.fn(),
    closeMock: vi.fn(),
  }));

vi.mock("@/lib/booking-messages/api", () => ({
  bookingMessagesApi: {
    list: listMock,
    send: sendMock,
    markRead: markReadMock,
  },
}));

vi.mock("@/lib/booking-messages/stream", () => ({
  openBookingMessageStream: openStreamMock,
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
  return render(<BookingMessagesPanel bookingRequestId="booking-1" />);
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
    openStreamMock.mockReturnValue({ close: closeMock });
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

    expect(bubbles[0]).toHaveAttribute("data-mine", "true");
    expect(bubbles[1]).toHaveAttribute("data-mine", "false");
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
    expect(screen.queryByText("Seen")).not.toBeInTheDocument();
  });

  it("flips the seen indicator on a read event", async () => {
    renderPanel();
    await screen.findByText("Is an early pickup possible?");

    expect(screen.queryByText("Seen")).not.toBeInTheDocument();

    captureStreamHandlers().onEvent({
      type: "messages.read",
      bookingRequestId: "booking-1",
      readerSide: "owner",
      readAt: "2026-08-10T12:10:00.000Z",
      markedCount: 1,
    });

    expect(await screen.findByText("Seen")).toBeInTheDocument();
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
    expect(bubbles[0]).toHaveAttribute("data-mine", "true");
    expect(bubbles[1]).toHaveAttribute("data-mine", "false");
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

    // Only the message that existed when the read ran shows a receipt.
    await waitFor(() => expect(screen.getAllByText("Seen")).toHaveLength(1));
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
