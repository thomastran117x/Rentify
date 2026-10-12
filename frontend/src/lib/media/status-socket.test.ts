import { describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io-client";
import {
  IDLE_CLOSE_MS,
  MAX_CONSECUTIVE_SOCKET_FAILURES,
  createMediaStatusChannel,
  type MediaStatusChannelDependencies,
} from "./status-socket";

vi.mock("@/lib/api/client", () => ({ authenticatedJson: vi.fn() }));
vi.mock("@/lib/env", () => ({
  resolveApiBaseUrl: () => "https://api.example.test/api/v1",
}));

/** A socket whose server side a test plays by firing its events. */
function fakeSocket() {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const socket = {
    disconnected: false,
    on(name: string, handler: (...args: unknown[]) => void) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return socket;
    },
    fire(name: string, ...args: unknown[]) {
      for (const handler of handlers.get(name) ?? []) {
        handler(...args);
      }
    },
    disconnect() {
      socket.disconnected = true;
      socket.fire("disconnect", "io client disconnect");
      return socket;
    },
  };
  return socket;
}

type FakeSocket = ReturnType<typeof fakeSocket>;

/**
 * Dependencies with every effect recorded: tickets minted, sockets opened, and
 * timers scheduled, which a test runs by hand.
 */
function harness(mintTicket: () => Promise<unknown> = async () => ({})) {
  const sockets: FakeSocket[] = [];
  const timers: Array<{ callback: () => void; ms: number; cleared: boolean }> =
    [];
  const dependencies: MediaStatusChannelDependencies = {
    mintTicket: vi.fn(mintTicket),
    connect: vi.fn(() => {
      const socket = fakeSocket();
      sockets.push(socket);
      return socket as unknown as Socket;
    }),
    setTimeout: (callback, ms) => {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      (timer as { cleared: boolean }).cleared = true;
    },
  };

  return {
    channel: createMediaStatusChannel(dependencies),
    dependencies,
    sockets,
    timers,
    /** Runs every timer scheduled and not yet run or cleared. */
    runTimers() {
      for (const timer of timers.splice(0)) {
        if (!timer.cleared) {
          timer.callback();
        }
      }
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createMediaStatusChannel", () => {
  it("mints a ticket and opens one credentialed socket on the media path", async () => {
    const { channel, dependencies, sockets } = harness();

    channel.acquire();
    channel.acquire();
    await settle();

    expect(dependencies.mintTicket).toHaveBeenCalledTimes(1);
    expect(dependencies.connect).toHaveBeenCalledWith(
      "https://api.example.test",
      {
        path: "/ws/media",
        withCredentials: true,
        reconnection: false,
        forceNew: true,
      },
    );
    expect(sockets).toHaveLength(1);
  });

  it("listens only once the server says the socket is in its room", async () => {
    const { channel, sockets } = harness();

    channel.acquire();
    await settle();
    expect(channel.isListening()).toBe(false);

    sockets[0]!.fire("ready", { type: "ready" });
    expect(channel.isListening()).toBe(true);
  });

  it("hands each push to the listeners of its item until they unsubscribe", async () => {
    const { channel, sockets } = harness();
    const first = vi.fn();
    const other = vi.fn();
    channel.acquire();
    await settle();
    const unsubscribe = channel.onStatus("m-1", first);
    channel.onStatus("m-2", other);

    sockets[0]!.fire("media.status", { mediaId: "m-1", status: "ready" });
    unsubscribe();
    sockets[0]!.fire("media.status", { mediaId: "m-1", status: "ready" });
    sockets[0]!.fire("media.status", null);

    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith({ mediaId: "m-1", status: "ready" });
    expect(other).not.toHaveBeenCalled();
  });

  it("closes the socket a while after the last upload lets go, not before", async () => {
    const { channel, sockets, timers, runTimers } = harness();
    const releaseFirst = channel.acquire();
    const releaseSecond = channel.acquire();
    await settle();

    releaseFirst();
    releaseFirst();
    expect(timers).toHaveLength(0);

    releaseSecond();
    expect(timers).toEqual([
      expect.objectContaining({ ms: IDLE_CLOSE_MS, cleared: false }),
    ]);
    runTimers();

    expect(sockets[0]!.disconnected).toBe(true);
    expect(channel.isListening()).toBe(false);
  });

  it("keeps the socket for an upload that starts before the idle close", async () => {
    const { channel, sockets, timers, runTimers } = harness();
    const release = channel.acquire();
    await settle();
    release();

    channel.acquire();
    expect(timers[0]?.cleared).toBe(true);
    runTimers();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.disconnected).toBe(false);
  });

  it("retries a failed ticket further apart each time, then gives up", async () => {
    const { channel, dependencies, timers, runTimers } = harness(async () => {
      throw new Error("offline");
    });
    channel.acquire();
    const delays: number[] = [];

    for (
      let attempt = 0;
      attempt < MAX_CONSECUTIVE_SOCKET_FAILURES;
      attempt++
    ) {
      await settle();
      delays.push(...timers.map((timer) => timer.ms));
      runTimers();
    }
    await settle();

    expect(delays).toEqual([1_000, 2_000, 3_000, 4_000]);
    expect(dependencies.mintTicket).toHaveBeenCalledTimes(
      MAX_CONSECUTIVE_SOCKET_FAILURES,
    );
    expect(timers).toHaveLength(0);
  });

  it("reconnects with a fresh ticket after a refused handshake or a dropped connection", async () => {
    const { channel, dependencies, sockets, runTimers } = harness();
    channel.acquire();
    await settle();

    sockets[0]!.fire("connect_error", new Error("Unauthorized"));
    runTimers();
    await settle();
    sockets[1]!.fire("ready");
    expect(channel.isListening()).toBe(true);

    sockets[1]!.fire("disconnect", "transport close");
    expect(channel.isListening()).toBe(false);
    runTimers();
    await settle();

    expect(dependencies.mintTicket).toHaveBeenCalledTimes(3);
    expect(sockets).toHaveLength(3);
  });

  it("ignores events from a socket it has already replaced", async () => {
    const { channel, sockets, runTimers } = harness();
    channel.acquire();
    await settle();
    sockets[0]!.fire("connect_error", new Error("Unauthorized"));
    runTimers();
    await settle();

    sockets[0]!.fire("disconnect", "transport close");
    sockets[0]!.fire("connect_error", new Error("late"));

    expect(sockets).toHaveLength(2);
  });

  it("opens no socket when every upload let go while the ticket was minted", async () => {
    let finishMint: () => void = () => {};
    const { channel, dependencies } = harness(
      () => new Promise<void>((resolve) => (finishMint = resolve)),
    );

    channel.acquire()();
    finishMint();
    await settle();

    expect(dependencies.connect).not.toHaveBeenCalled();
  });

  it("stops retrying once nothing is waiting", async () => {
    const { channel, timers } = harness(async () => {
      throw new Error("offline");
    });

    channel.acquire()();
    await settle();

    // Only the idle close is scheduled, no retry.
    expect(timers.map((timer) => timer.ms)).toEqual([IDLE_CLOSE_MS]);
  });
});
