import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refreshStoredSessionMock, readStoredSessionMock } = vi.hoisted(() => ({
  refreshStoredSessionMock: vi.fn(),
  readStoredSessionMock: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  refreshStoredSession: refreshStoredSessionMock,
}));

vi.mock("@/lib/auth/storage", () => ({
  readStoredSession: readStoredSessionMock,
}));

vi.mock("@/lib/auth/device", () => ({
  getDeviceId: () => "device-1",
  getDevicePlatform: () => "test-os",
}));

vi.mock("@/lib/env", () => ({
  resolveApiBaseUrl: () => "https://api.test/api/v1",
}));

const { openBookingMessageStream, parseSseFrame } = await import(
  "@/lib/booking-messages/stream"
);

/**
 * Builds a Response whose body emits the given chunks, in order.
 *
 * Stays open by default, like a real SSE connection — closing the body is a
 * disconnect, which legitimately makes the client schedule a reconnect and
 * would race any assertion on the fetch count.
 */
const openControllers: ReadableStreamDefaultController<Uint8Array>[] = [];

function streamingResponse(
  chunks: string[],
  options: { close?: boolean } = {},
) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        if (options.close) {
          controller.close();
        } else {
          openControllers.push(controller);
        }
      },
    }),
    { status: 200 },
  );
}

/** Closes any stream left open so no reader promise outlives its test. */
function closeOpenStreams(): void {
  for (const controller of openControllers.splice(0)) {
    try {
      controller.close();
    } catch {
      // Already closed.
    }
  }
}

const READY_FRAME = 'event: ready\ndata: {"bookingRequestId":"booking-1"}\n\n';

function createdFrame(id: string): string {
  return `event: message.created\nid: ${id}\ndata: ${JSON.stringify({
    type: "message.created",
    bookingRequestId: "booking-1",
    message: { id },
  })}\n\n`;
}

function setVisibilityState(value: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
}

/**
 * Drops the own-property override so `visibilityState` falls back to jsdom's
 * prototype getter. The Document is shared for the whole file, so leaving the
 * override in place would leak into every later test.
 */
function restoreVisibilityState(): void {
  delete (document as unknown as Record<string, unknown>).visibilityState;
}

async function flush(times = 12): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe("parseSseFrame", () => {
  it("parses event, id, and data fields", () => {
    expect(parseSseFrame('event: ready\nid: 7\ndata: {"a":1}')).toEqual({
      event: "ready",
      id: "7",
      data: '{"a":1}',
    });
  });

  it("joins multiple data lines with a newline", () => {
    expect(parseSseFrame("event: x\ndata: one\ndata: two")).toEqual({
      event: "x",
      data: "one\ntwo",
    });
  });

  it("ignores comment lines and frames without data", () => {
    expect(parseSseFrame(": keep-alive\nevent: x")).toBeNull();
  });

  it("strips only a single leading space from values", () => {
    expect(parseSseFrame("data:  padded")).toEqual({ data: " padded" });
  });
});

describe("openBookingMessageStream", () => {
  beforeEach(() => {
    refreshStoredSessionMock.mockReset();
    readStoredSessionMock.mockReset();
    readStoredSessionMock.mockReturnValue({ accessToken: "token-1" });
  });

  afterEach(() => {
    closeOpenStreams();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    restoreVisibilityState();
  });

  it("sends the bearer token and reports open on the ready frame", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([READY_FRAME]));
    vi.stubGlobal("fetch", fetchMock);

    const onStatus = vi.fn();
    const handle = openBookingMessageStream({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus,
    });

    await flush();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://api.test/api/v1/booking-requests/booking-1/messages/stream",
    );
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer token-1",
    );
    expect((init.headers as Record<string, string>).accept).toBe(
      "text/event-stream",
    );
    expect(onStatus).toHaveBeenCalledWith("open");

    handle.close();
  });

  it("emits parsed events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamingResponse([READY_FRAME, createdFrame("message-1")]),
      ),
    );

    const onEvent = vi.fn();
    const handle = openBookingMessageStream({
      bookingRequestId: "booking-1",
      onEvent,
      onStatus: vi.fn(),
    });

    await flush();

    expect(onEvent).toHaveBeenCalledWith({
      type: "message.created",
      bookingRequestId: "booking-1",
      message: { id: "message-1" },
    });

    handle.close();
  });

  it("buffers a frame split across chunk boundaries", async () => {
    const full = createdFrame("message-2");
    const splitAt = Math.floor(full.length / 2);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamingResponse([
          READY_FRAME,
          full.slice(0, splitAt),
          full.slice(splitAt),
        ]),
      ),
    );

    const onEvent = vi.fn();
    const handle = openBookingMessageStream({
      bookingRequestId: "booking-1",
      onEvent,
      onStatus: vi.fn(),
    });

    await flush(20);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: { id: "message-2" } }),
    );

    handle.close();
  });

  it("does not surface heartbeats to the caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamingResponse([READY_FRAME, "event: heartbeat\ndata: 123\n\n"]),
      ),
    );

    const onEvent = vi.fn();
    const handle = openBookingMessageStream({
      bookingRequestId: "booking-1",
      onEvent,
      onStatus: vi.fn(),
    });

    await flush();

    expect(onEvent).not.toHaveBeenCalled();

    handle.close();
  });

  it("ignores malformed frames without tearing down the stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamingResponse([
          READY_FRAME,
          "event: message.created\ndata: {broken\n\n",
          createdFrame("message-3"),
        ]),
      ),
    );

    const onEvent = vi.fn();
    const handle = openBookingMessageStream({
      bookingRequestId: "booking-1",
      onEvent,
      onStatus: vi.fn(),
    });

    await flush(20);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: { id: "message-3" } }),
    );

    handle.close();
  });

  it("refreshes the session once on 401 and retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(streamingResponse([READY_FRAME]));
    vi.stubGlobal("fetch", fetchMock);
    refreshStoredSessionMock.mockResolvedValue({ accessToken: "token-2" });

    const onStatus = vi.fn();
    const handle = openBookingMessageStream({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus,
    });

    await flush(20);

    expect(refreshStoredSessionMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onStatus).toHaveBeenCalledWith("open");

    handle.close();
  });

  it("fails without retrying when the refresh returns nothing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    refreshStoredSessionMock.mockResolvedValue(null);

    const onStatus = vi.fn();
    const handle = openBookingMessageStream({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus,
    });

    await flush(20);

    expect(onStatus).toHaveBeenCalledWith("failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    handle.close();
  });

  it("reports failed after the consecutive failure budget is spent", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    const onStatus = vi.fn();
    const handle = openBookingMessageStream({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus,
    });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await vi.advanceTimersByTimeAsync(20_000);
    }

    expect(onStatus).toHaveBeenCalledWith("reconnecting");
    expect(onStatus).toHaveBeenCalledWith("failed");

    handle.close();
  });

  it("honours retry-after on 429", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "retry-after": "30" } }),
      )
      .mockResolvedValue(streamingResponse([READY_FRAME]));
    vi.stubGlobal("fetch", fetchMock);

    const handle = openBookingMessageStream({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Nothing should retry before the server-provided delay elapses.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(11_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    handle.close();
  });

  it("stops fetching once closed", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([READY_FRAME]));
    vi.stubGlobal("fetch", fetchMock);

    const handle = openBookingMessageStream({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();
    handle.close();
    await flush(20);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("closes on hidden and reopens on visible", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([READY_FRAME]));
    vi.stubGlobal("fetch", fetchMock);

    const handle = openBookingMessageStream({
      bookingRequestId: "booking-1",
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);

    handle.close();
  });
});
