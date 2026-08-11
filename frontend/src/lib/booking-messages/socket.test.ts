import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authenticatedJsonMock } = vi.hoisted(() => ({
  authenticatedJsonMock: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  authenticatedJson: authenticatedJsonMock,
}));

vi.mock("@/lib/env", () => ({
  resolveApiBaseUrl: () => "https://api.test/api/v1",
}));

const { openBookingMessageSocket } = await import(
  "@/lib/booking-messages/socket"
);

/** Minimal stand-in: jsdom has no WebSocket, and the tests drive it directly. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emit(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

async function flush(times = 12): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe("openBookingMessageSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    authenticatedJsonMock.mockReset();
    authenticatedJsonMock.mockResolvedValue({ expiresInSeconds: 30 });
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("exchanges a ticket before connecting and carries no credential in the URL", async () => {
    const handle = openBookingMessageSocket({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "POST",
      "/booking-requests/booking-1/messages/socket-ticket",
    );

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe("wss://api.test/ws/booking-messages");
    // The ticket lives in an HttpOnly cookie the browser attaches itself.
    expect(socket.url).not.toContain("ticket");

    handle.close();
  });

  it("reports open and forwards frames, swallowing the ready handshake", async () => {
    const onEvent = vi.fn();
    const onStatus = vi.fn();
    const handle = openBookingMessageSocket({
      bookingRequestId: "booking-1",
      onEvent,
      onStatus,
    });

    await flush();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    expect(onStatus).toHaveBeenCalledWith("open");

    socket.emit({ type: "ready", bookingRequestId: "booking-1" });
    expect(onEvent).not.toHaveBeenCalled();

    socket.emit({ type: "message.created", bookingRequestId: "booking-1" });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "message.created" }),
    );

    handle.close();
  });

  it("ignores a malformed frame", async () => {
    const onEvent = vi.fn();
    const handle = openBookingMessageSocket({
      bookingRequestId: "booking-1",
      onEvent,
      onStatus: vi.fn(),
    });

    await flush();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.onmessage?.({ data: "not json" });

    expect(onEvent).not.toHaveBeenCalled();

    handle.close();
  });

  it("throttles typing frames and drops them while closed", async () => {
    const handle = openBookingMessageSocket({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();
    const socket = FakeWebSocket.instances[0];

    // Nothing is sent before the socket opens.
    handle.sendTyping();
    expect(socket.sent).toHaveLength(0);

    socket.open();
    handle.sendTyping();
    handle.sendTyping();
    handle.sendTyping();

    expect(socket.sent).toEqual([JSON.stringify({ type: "typing" })]);

    handle.close();
  });

  it("sends delivery acknowledgements and ignores empty batches", async () => {
    const handle = openBookingMessageSocket({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    handle.sendDelivered([]);
    expect(socket.sent).toHaveLength(0);

    handle.sendDelivered(["m1", "m2"]);
    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "delivered",
      messageIds: ["m1", "m2"],
    });

    handle.close();
  });

  it("backs off when the ticket exchange fails", async () => {
    vi.useFakeTimers();
    authenticatedJsonMock.mockRejectedValue(new Error("unauthorized"));
    const onStatus = vi.fn();

    const handle = openBookingMessageSocket({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus,
    });

    await vi.advanceTimersByTimeAsync(0);

    // A rejected exchange must not hammer the endpoint.
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(onStatus).toHaveBeenCalledWith("reconnecting");

    await vi.advanceTimersByTimeAsync(2_000);
    expect(authenticatedJsonMock.mock.calls.length).toBeGreaterThan(1);

    handle.close();
  });

  it("reports failed after the consecutive failure budget is spent", async () => {
    vi.useFakeTimers();
    authenticatedJsonMock.mockRejectedValue(new Error("unauthorized"));
    const onStatus = vi.fn();

    const handle = openBookingMessageSocket({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus,
    });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await vi.advanceTimersByTimeAsync(20_000);
    }

    expect(onStatus).toHaveBeenCalledWith("failed");

    handle.close();
  });

  it("reconnects when the socket closes unexpectedly", async () => {
    vi.useFakeTimers();

    const handle = openBookingMessageSocket({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].close();

    await vi.advanceTimersByTimeAsync(3_000);

    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);

    handle.close();
  });

  it("does not reconnect after the caller closes it", async () => {
    vi.useFakeTimers();

    const handle = openBookingMessageSocket({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.instances[0].open();
    handle.close();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
