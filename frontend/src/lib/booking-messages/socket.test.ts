import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authenticatedJsonMock, ioMock } = vi.hoisted(() => ({
  authenticatedJsonMock: vi.fn(),
  ioMock: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  authenticatedJson: authenticatedJsonMock,
}));

vi.mock("@/lib/env", () => ({
  resolveApiBaseUrl: () => "https://api.test/api/v1",
}));

vi.mock("socket.io-client", () => ({
  io: ioMock,
}));

const { openBookingMessageSocket } = await import(
  "@/lib/booking-messages/socket"
);

/**
 * A stand-in for a Socket.IO client. Only the surface this module uses is
 * implemented, so a new dependency on the library shows up as a loud failure
 * rather than a silent pass.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];

  connected = false;
  emitted: Array<{ event: string; payload?: unknown }> = [];
  disconnected = 0;
  private readonly listeners = new Map<string, Array<(arg: never) => void>>();

  constructor(
    public readonly url: string,
    public readonly options: Record<string, unknown>,
  ) {
    FakeSocket.instances.push(this);
  }

  on(event: string, listener: (arg: never) => void): this {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  off(): this {
    return this;
  }

  emit(event: string, payload?: unknown): this {
    this.emitted.push({ event, payload });
    return this;
  }

  disconnect(): this {
    this.connected = false;
    this.disconnected += 1;
    return this;
  }

  /** Drives a server-side event into the client. */
  fire(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (arg: unknown) => void)(payload);
    }
  }

  open(): void {
    this.connected = true;
    this.fire("connect");
  }
}

async function flush(times = 12): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe("openBookingMessageSocket", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    authenticatedJsonMock.mockReset();
    authenticatedJsonMock.mockResolvedValue({ expiresInSeconds: 30 });
    ioMock.mockReset();
    ioMock.mockImplementation(
      (url: string, options: Record<string, unknown>) =>
        new FakeSocket(url, options),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mints a ticket before connecting and carries no credential in the URL", async () => {
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

    const [url, options] = ioMock.mock.calls[0];
    expect(url).toBe("https://api.test");
    expect(options).toMatchObject({
      path: "/ws/booking-messages",
      // The ticket lives in an HttpOnly cookie the browser attaches itself.
      withCredentials: true,
    });
    expect(JSON.stringify(options)).not.toContain("ticket");

    handle.close();
  });

  it("reports open and forwards events, swallowing the ready handshake", async () => {
    const onEvent = vi.fn();
    const onStatus = vi.fn();
    const handle = openBookingMessageSocket({
      bookingRequestId: "booking-1",
      onEvent,
      onStatus,
    });

    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();

    expect(onStatus).toHaveBeenCalledWith("open");

    socket.fire("ready", { type: "ready", bookingRequestId: "booking-1" });
    expect(onEvent).not.toHaveBeenCalled();

    socket.fire("message.created", {
      type: "message.created",
      bookingRequestId: "booking-1",
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "message.created" }),
    );

    handle.close();
  });

  it("drops a socket that was handed another booking's ticket", async () => {
    const onEvent = vi.fn();
    const handle = openBookingMessageSocket({
      bookingRequestId: "booking-1",
      onEvent,
      onStatus: vi.fn(),
    });

    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();

    // Two tabs on one origin share the ticket cookie, so a tab can end up
    // holding the other's ticket and joining the wrong thread's room. The
    // server stays consistent — it joined the room its ticket named — but this
    // tab would render someone else's conversation.
    socket.fire("message.created", {
      type: "message.created",
      bookingRequestId: "booking-2",
    });

    expect(onEvent).not.toHaveBeenCalled();
    expect(socket.disconnected).toBe(1);

    await flush();
    expect(FakeSocket.instances.length).toBeGreaterThan(1);

    handle.close();
  });

  it("throttles typing and drops it while disconnected", async () => {
    const handle = openBookingMessageSocket({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();
    const socket = FakeSocket.instances[0];

    // Nothing goes out before the socket connects, and the attempt must not
    // spend the throttle window — that suppressed the first real indicator
    // after connecting.
    handle.sendTyping();
    expect(socket.emitted).toHaveLength(0);

    socket.open();
    handle.sendTyping();
    handle.sendTyping();
    handle.sendTyping();

    expect(socket.emitted).toEqual([{ event: "typing", payload: undefined }]);

    handle.close();
  });

  it("sends delivery acknowledgements and ignores empty batches", async () => {
    const handle = openBookingMessageSocket({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();

    handle.sendDelivered([]);
    expect(socket.emitted).toHaveLength(0);

    handle.sendDelivered(["m1", "m2"]);
    expect(socket.emitted[0]).toEqual({
      event: "delivered",
      payload: ["m1", "m2"],
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

    // A rejected exchange must not hammer the endpoint, and no socket is opened
    // without a ticket to present.
    expect(ioMock).not.toHaveBeenCalled();
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

  it("mints a fresh ticket for each reconnect", async () => {
    const handle = openBookingMessageSocket({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();

    // A ticket is single-use, so Socket.IO's own reconnection is off and the
    // retry is driven from here — reconnecting silently would present a ticket
    // that has already been spent.
    expect(socket.options.reconnection).toBe(false);

    socket.fire("disconnect", "transport close");
    await flush();

    expect(authenticatedJsonMock).toHaveBeenCalledTimes(2);
    expect(FakeSocket.instances).toHaveLength(2);

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
    const socket = FakeSocket.instances[0];
    socket.open();
    handle.close();

    socket.fire("disconnect", "io client disconnect");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(FakeSocket.instances).toHaveLength(1);
  });
});
