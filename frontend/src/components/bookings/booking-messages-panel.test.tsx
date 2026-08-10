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

  it("closes the stream on unmount", async () => {
    const { unmount } = renderPanel();
    await screen.findByText("Is an early pickup possible?");

    unmount();

    expect(closeMock).toHaveBeenCalled();
  });

  it("surfaces a load failure", async () => {
    listMock.mockRejectedValue(new Error("boom"));

    renderPanel();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
