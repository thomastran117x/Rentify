import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { optionalAuthJsonMock, ioMock } = vi.hoisted(() => ({
  optionalAuthJsonMock: vi.fn(),
  ioMock: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  optionalAuthJson: optionalAuthJsonMock,
}));

vi.mock("@/lib/env", () => ({
  resolveApiBaseUrl: () => "https://api.test/api/v1",
}));

vi.mock("socket.io-client", () => ({
  io: ioMock,
}));

const { openBlogCommentSocket, MAX_CONSECUTIVE_SOCKET_FAILURES } = await import(
  "@/lib/blog-comments/socket"
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

const OPTIONS = {
  organizationId: "org-1",
  slug: "my-post",
  blogPostId: "blog-1",
};

describe("openBlogCommentSocket", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    optionalAuthJsonMock.mockReset();
    optionalAuthJsonMock.mockResolvedValue({ expiresInSeconds: 30 });
    ioMock.mockReset();
    ioMock.mockImplementation(
      (url: string, options: Record<string, unknown>) =>
        new FakeSocket(url, options),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mints a ticket with optional auth so a guest can connect", async () => {
    const handle = openBlogCommentSocket({
      ...OPTIONS,
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();

    // Optional rather than authenticated: live delivery to anonymous readers
    // is the point of this surface.
    expect(optionalAuthJsonMock).toHaveBeenCalledWith(
      "POST",
      "/organizations/org-1/blog/my-post/comments/socket-ticket",
    );

    handle.close();
  });

  it("carries no credential in the URL and asks for its own manager", async () => {
    const handle = openBlogCommentSocket({
      ...OPTIONS,
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();

    const [url, options] = ioMock.mock.calls[0];
    expect(url).toBe("https://api.test");
    expect(options).toMatchObject({
      path: "/ws/blog-comments",
      // The ticket lives in an HttpOnly cookie the browser attaches itself.
      withCredentials: true,
      reconnection: false,
      // Managers are cached by origin, not by path: without this a page with a
      // booking thread open could hand this call the other gateway's manager.
      forceNew: true,
    });
    expect(JSON.stringify(options)).not.toContain("ticket");

    handle.close();
  });

  it("encodes the organization and slug", async () => {
    const handle = openBlogCommentSocket({
      organizationId: "org/1",
      slug: "a b",
      blogPostId: "blog-1",
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();

    expect(optionalAuthJsonMock).toHaveBeenCalledWith(
      "POST",
      "/organizations/org%2F1/blog/a%20b/comments/socket-ticket",
    );

    handle.close();
  });

  it("reports open and forwards events, swallowing the ready handshake", async () => {
    const onEvent = vi.fn();
    const onStatus = vi.fn();
    const handle = openBlogCommentSocket({
      ...OPTIONS,
      onEvent,
      onStatus,
    });

    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();

    expect(onStatus).toHaveBeenCalledWith("open");

    socket.fire("ready", { type: "ready", blogPostId: "blog-1" });
    expect(onEvent).not.toHaveBeenCalled();

    const created = {
      type: "comment.created",
      blogPostId: "blog-1",
      comment: { id: "comment-1" },
    };
    socket.fire("comment.created", created);

    expect(onEvent).toHaveBeenCalledWith(created);

    handle.close();
  });

  it("forwards presence, typing and the comments toggle", async () => {
    const onEvent = vi.fn();
    const handle = openBlogCommentSocket({
      ...OPTIONS,
      onEvent,
      onStatus: vi.fn(),
    });

    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();

    socket.fire("presence", {
      type: "presence",
      blogPostId: "blog-1",
      readerCount: 4,
    });
    socket.fire("comments.closed", {
      type: "comments.closed",
      blogPostId: "blog-1",
      commentsEnabled: false,
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "presence", readerCount: 4 }),
    );
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "comments.closed" }),
    );

    handle.close();
  });

  it("reconnects when the server admits it to the wrong post", async () => {
    vi.useFakeTimers();
    const handle = openBlogCommentSocket({
      ...OPTIONS,
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();

    // Two tabs share the ticket cookie, so this socket can redeem the other's
    // ticket. `ready` names the room it actually joined, and it is the only
    // prompt evidence — waiting for a mismatched event would leave this tab
    // silently missing everything for the post it is showing.
    socket.fire("ready", { type: "ready", blogPostId: "blog-other" });
    await flush();

    expect(socket.disconnected).toBeGreaterThan(0);
    // Backed off rather than immediate, so two tabs cannot ping-pong over the
    // shared cookie without pause.
    expect(FakeSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_000);
    await flush();

    expect(FakeSocket.instances.length).toBeGreaterThan(1);

    handle.close();
    vi.useRealTimers();
  });

  it("stays connected when ready names the right post", async () => {
    const handle = openBlogCommentSocket({
      ...OPTIONS,
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();

    socket.fire("ready", { type: "ready", blogPostId: "blog-1" });
    await flush();

    expect(socket.disconnected).toBe(0);
    expect(FakeSocket.instances).toHaveLength(1);

    handle.close();
  });

  it("reconnects rather than rendering another post's comments", async () => {
    const onEvent = vi.fn();
    const handle = openBlogCommentSocket({
      ...OPTIONS,
      onEvent,
      onStatus: vi.fn(),
    });

    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();

    // Two tabs on one origin share the ticket cookie, so a tab can end up
    // holding the other's ticket.
    socket.fire("comment.created", {
      type: "comment.created",
      blogPostId: "blog-other",
      comment: { id: "comment-9" },
    });

    expect(onEvent).not.toHaveBeenCalled();
    expect(socket.disconnected).toBeGreaterThan(0);

    handle.close();
  });

  it("mints a fresh ticket for every attempt", async () => {
    vi.useFakeTimers();
    const handle = openBlogCommentSocket({
      ...OPTIONS,
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();
    expect(optionalAuthJsonMock).toHaveBeenCalledTimes(1);

    const socket = FakeSocket.instances[0];
    socket.open();
    socket.fire("ready", { type: "ready", blogPostId: "blog-1" });
    socket.fire("disconnect", "transport close");
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();

    // A ticket is single-use, so a reconnect cannot replay the old one.
    expect(optionalAuthJsonMock).toHaveBeenCalledTimes(2);

    handle.close();
    vi.useRealTimers();
  });

  it("gives up after a bounded number of failures", async () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    optionalAuthJsonMock.mockRejectedValue(new Error("no ticket"));

    const handle = openBlogCommentSocket({
      ...OPTIONS,
      onEvent: vi.fn(),
      onStatus,
    });

    for (
      let attempt = 0;
      attempt < MAX_CONSECUTIVE_SOCKET_FAILURES;
      attempt++
    ) {
      await flush();
      await vi.advanceTimersByTimeAsync(10_000);
    }

    await flush();

    // The panel falls back to polling rather than hammering the ticket route.
    expect(onStatus).toHaveBeenCalledWith("failed");

    handle.close();
  });

  it("throttles typing and only counts frames that go out", async () => {
    const handle = openBlogCommentSocket({
      ...OPTIONS,
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();
    const socket = FakeSocket.instances[0];

    // Disconnected: the attempt must not spend the throttle window.
    handle.sendTyping();
    expect(socket.emitted).toHaveLength(0);

    socket.open();
    handle.sendTyping();
    handle.sendTyping();

    expect(socket.emitted.filter((f) => f.event === "typing")).toHaveLength(1);

    handle.close();
  });

  it("counts a room mismatch as a failure and eventually gives up", async () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const handle = openBlogCommentSocket({
      ...OPTIONS,
      onEvent: vi.fn(),
      onStatus,
    });

    // Every attempt connects successfully and is then rejected for landing in
    // the wrong room. Without counting these the two tabs would ping-pong
    // forever, with no backoff and no path to the polling fallback.
    for (
      let attempt = 0;
      attempt < MAX_CONSECUTIVE_SOCKET_FAILURES;
      attempt++
    ) {
      await flush();
      const socket = FakeSocket.instances.at(-1);

      if (!socket) {
        break;
      }

      socket.open();
      socket.fire("ready", { type: "ready", blogPostId: "blog-other" });
      await flush();
      await vi.advanceTimersByTimeAsync(10_000);
    }

    await flush();

    expect(onStatus).toHaveBeenCalledWith("failed");

    handle.close();
    vi.useRealTimers();
  });

  it("resets the failure budget only once the room is confirmed", async () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const handle = openBlogCommentSocket({
      ...OPTIONS,
      onEvent: vi.fn(),
      onStatus,
    });

    // Two mismatches, then a good one: the budget must clear so a later
    // unrelated blip does not inherit them.
    for (let attempt = 0; attempt < 2; attempt++) {
      await flush();
      const socket = FakeSocket.instances.at(-1);
      socket?.open();
      socket?.fire("ready", { type: "ready", blogPostId: "blog-other" });
      await flush();
      await vi.advanceTimersByTimeAsync(10_000);
    }

    await flush();
    const good = FakeSocket.instances.at(-1);
    good?.open();
    good?.fire("ready", { type: "ready", blogPostId: "blog-1" });
    await flush();

    onStatus.mockClear();
    good?.fire("disconnect", "transport close");
    await flush();

    // First failure after a confirmed connection, so it reconnects rather than
    // giving up on an inherited count.
    expect(onStatus).toHaveBeenCalledWith("reconnecting");
    expect(onStatus).not.toHaveBeenCalledWith("failed");

    handle.close();
    vi.useRealTimers();
  });

  it("stops reconnecting once closed", async () => {
    const handle = openBlogCommentSocket({
      ...OPTIONS,
      onEvent: vi.fn(),
      onStatus: vi.fn(),
    });

    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();

    handle.close();
    socket.fire("disconnect", "transport close");
    await flush();

    expect(FakeSocket.instances).toHaveLength(1);
  });
});
