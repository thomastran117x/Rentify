import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import {
  createRootContainer,
  setContainer,
} from "@/configuration/bootstrap/container";
import { containerTokens } from "@/configuration/container/tokens";
import {
  BOOKING_MESSAGE_SOCKET_PATH,
  BookingMessageSocketServer,
} from "@/features/bookings/messages/booking-message-socket.server";

const BOOKING_ID = "booking-1";
const USER_ID = "user-1";

interface Fakes {
  redeemSocketTicket: jest.Mock;
  authorizeStream: jest.Mock;
  assertSocketSessionValid: jest.Mock;
  markDelivered: jest.Mock;
  publishTyping: jest.Mock;
  join: jest.Mock;
  leave: jest.Mock;
  refresh: jest.Mock;
  isSideOnline: jest.Mock;
  release: jest.Mock;
  subscribe: jest.Mock;
  listeners: Array<(event: unknown) => void>;
}

/**
 * A container of fakes, so the socket server's own logic — upgrade handling,
 * frame routing, throttling, teardown — is exercised without any
 * infrastructure. The live wiring is covered separately by the integration
 * suite.
 */
function installFakeContainer(overrides: Partial<Fakes> = {}): Fakes {
  const listeners: Array<(event: unknown) => void> = [];
  const release = overrides.release ?? jest.fn(async () => undefined);

  const fakes: Fakes = {
    redeemSocketTicket:
      overrides.redeemSocketTicket ??
      jest.fn(async (ticket: string) =>
        ticket === "good"
          ? { bookingRequestId: BOOKING_ID, userId: USER_ID }
          : null,
      ),
    authorizeStream:
      overrides.authorizeStream ??
      jest.fn(async () => ({
        bookingRequestId: BOOKING_ID,
        side: "renter",
        canWrite: true,
      })),
    assertSocketSessionValid:
      overrides.assertSocketSessionValid ?? jest.fn(async () => undefined),
    markDelivered: overrides.markDelivered ?? jest.fn(async () => ["m1"]),
    publishTyping: overrides.publishTyping ?? jest.fn(async () => undefined),
    join: overrides.join ?? jest.fn(async () => undefined),
    leave: overrides.leave ?? jest.fn(async () => undefined),
    refresh: overrides.refresh ?? jest.fn(async () => undefined),
    isSideOnline: overrides.isSideOnline ?? jest.fn(async () => false),
    release,
    subscribe:
      overrides.subscribe ??
      jest.fn(async (_id: string, listener: (event: unknown) => void) => {
        listeners.push(listener);
        return release;
      }),
    listeners,
  };

  const container = createRootContainer();

  container.register({
    token: containerTokens.bookingMessagesService,
    lifetime: "scoped",
    dependencies: [],
    resolve: () =>
      ({
        redeemSocketTicket: fakes.redeemSocketTicket,
        authorizeStream: fakes.authorizeStream,
        assertSocketSessionValid: fakes.assertSocketSessionValid,
        markDelivered: fakes.markDelivered,
      }) as never,
  });
  container.register({
    token: containerTokens.bookingMessagePresenceService,
    lifetime: "scoped",
    dependencies: [],
    resolve: () =>
      ({
        publishTyping: fakes.publishTyping,
        join: fakes.join,
        leave: fakes.leave,
        refresh: fakes.refresh,
        isSideOnline: fakes.isSideOnline,
      }) as never,
  });
  container.register({
    token: containerTokens.bookingMessageStreamHub,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => ({ subscribe: fakes.subscribe }) as never,
  });

  setContainer(container);
  return fakes;
}

describe("BookingMessageSocketServer", () => {
  let socketServer: BookingMessageSocketServer;
  let httpServer: Server;
  let baseUrl: string;

  beforeEach(async () => {
    socketServer = new BookingMessageSocketServer();
    httpServer = createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    socketServer.attach(httpServer);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}${BOOKING_MESSAGE_SOCKET_PATH}`;
  });

  afterEach(async () => {
    await socketServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  interface Connection {
    socket: WebSocket;
    frames: Array<Record<string, unknown>>;
    waitFor(type: string, timeoutMs?: number): Promise<Record<string, unknown>>;
  }

  /**
   * The listener is attached before `open` resolves: `ready` is sent the moment
   * the upgrade completes, so a listener added afterwards can miss it.
   */
  async function connect(ticket = "good"): Promise<Connection> {
    const socket = new WebSocket(baseUrl, {
      headers: { cookie: `rentify_ws_ticket=${ticket}` },
    });
    const frames: Array<Record<string, unknown>> = [];

    socket.on("message", (raw) => {
      try {
        frames.push(JSON.parse(raw.toString()) as Record<string, unknown>);
      } catch {
        // Not a frame these tests assert on.
      }
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    return {
      socket,
      frames,
      async waitFor(type: string, timeoutMs = 10_000) {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
          const found = frames.find((frame) => frame.type === type);

          if (found) {
            return found;
          }

          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        throw new Error(`Timed out waiting for "${type}".`);
      },
    };
  }

  async function settle(times = 12): Promise<void> {
    for (let index = 0; index < times; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it("accepts a valid ticket and announces readiness", async () => {
    const fakes = installFakeContainer();

    const connection = await connect();
    const ready = await connection.waitFor("ready");

    expect(ready).toMatchObject({
      type: "ready",
      bookingRequestId: BOOKING_ID,
    });
    expect(fakes.redeemSocketTicket).toHaveBeenCalledWith("good");
    expect(fakes.join).toHaveBeenCalledWith(
      BOOKING_ID,
      "renter",
      expect.any(String),
    );

    connection.socket.close();
  }, 20_000);

  it("rejects an upgrade with no ticket cookie at all", async () => {
    const fakes = installFakeContainer();

    const socket = new WebSocket(baseUrl);
    const error = await new Promise<Error>((resolve) =>
      socket.once("error", resolve),
    );

    expect(error.message).toMatch(/401/);
    expect(fakes.redeemSocketTicket).toHaveBeenCalledWith("");
    socket.terminate();
  }, 20_000);

  it("rejects an upgrade whose ticket does not redeem", async () => {
    installFakeContainer();

    const socket = new WebSocket(baseUrl, {
      headers: { cookie: "rentify_ws_ticket=bad" },
    });
    const error = await new Promise<Error>((resolve) =>
      socket.once("error", resolve),
    );

    expect(error.message).toMatch(/401/);
    socket.terminate();
  }, 20_000);

  it("rejects an upgrade from an origin that is not allow-listed", async () => {
    const fakes = installFakeContainer();

    const socket = new WebSocket(baseUrl, {
      headers: {
        cookie: "rentify_ws_ticket=good",
        origin: "https://evil.example.com",
      },
    });
    const error = await new Promise<Error>((resolve) =>
      socket.once("error", resolve),
    );

    // This handler is attached to the raw Node server, so it never passes
    // through the CORS or CSRF middleware. `SameSite=Lax` is scoped to the
    // site rather than the origin, so a sibling origin gets the ticket cookie
    // attached to any upgrade it attempts.
    expect(error.message).toMatch(/403/);
    expect(fakes.redeemSocketTicket).not.toHaveBeenCalled();
    socket.terminate();
  }, 20_000);

  it("accepts an upgrade with no origin header at all", async () => {
    installFakeContainer();

    // Non-browser clients send no origin and carry no ambient cookie, so
    // requiring the header would break them without deterring a browser.
    const connection = await connect();
    await connection.waitFor("ready");

    connection.socket.close();
  }, 20_000);

  it("closes an upgrade on an unrecognised path", async () => {
    installFakeContainer();
    const { port } = httpServer.address() as AddressInfo;

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/something-else`);
    const error = await new Promise<Error>((resolve) =>
      socket.once("error", resolve),
    );

    // Registering an upgrade listener stops Node destroying unmatched
    // upgrades, so an unanswered path would hold the socket open forever.
    expect(error.message).toMatch(/404/);
    socket.terminate();
  }, 20_000);

  it("forwards hub events to the connected client", async () => {
    const fakes = installFakeContainer();
    const connection = await connect();
    await connection.waitFor("ready");

    fakes.listeners[0]?.({
      type: "message.created",
      bookingRequestId: BOOKING_ID,
    });

    expect(await connection.waitFor("message.created")).toMatchObject({
      type: "message.created",
    });

    connection.socket.close();
  }, 20_000);

  it("throttles typing frames", async () => {
    const fakes = installFakeContainer();
    const { socket, waitFor } = await connect();
    await waitFor("ready");

    socket.send(JSON.stringify({ type: "typing" }));
    socket.send(JSON.stringify({ type: "typing" }));
    socket.send(JSON.stringify({ type: "typing" }));
    await settle();

    // A client ignoring its own throttle must not flood the thread channel.
    expect(fakes.publishTyping).toHaveBeenCalledTimes(1);

    socket.close();
  }, 20_000);

  it("handles a frame that arrives before the capability lookup settles", async () => {
    const fakes = installFakeContainer({
      // A slow lookup makes the window deterministic. It is real either way:
      // this is a database round trip, and a client can send its first frame
      // the instant the handshake completes.
      authorizeStream: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { bookingRequestId: BOOKING_ID, side: "renter", canWrite: true };
      }),
    });

    const socket = new WebSocket(baseUrl, {
      headers: { cookie: "rentify_ws_ticket=good" },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    // Sent immediately, well before the lookup resolves. Attaching the message
    // listener after that await dropped this frame outright; judging it against
    // the default-closed capability would silently discard it instead.
    socket.send(JSON.stringify({ type: "typing" }));
    await settle(60);

    expect(fakes.publishTyping).toHaveBeenCalledTimes(1);

    socket.close();
  }, 20_000);

  it("drops typing frames from a participant who cannot write", async () => {
    const fakes = installFakeContainer({
      authorizeStream: jest.fn(async () => ({
        bookingRequestId: BOOKING_ID,
        side: "owner",
        canWrite: false,
      })),
    });
    const { socket, waitFor } = await connect();
    await waitFor("ready");

    socket.send(JSON.stringify({ type: "typing" }));
    await settle(20);

    // A read-only organization member connects legitimately — the UI simply
    // withholds their composer — but nothing stops them sending this by hand,
    // and the renter would see someone who cannot reply appear to be typing.
    expect(fakes.publishTyping).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(WebSocket.OPEN);

    socket.close();
  }, 20_000);

  it("keeps the side present when a colleague on it is still connected", async () => {
    const fakes = installFakeContainer({
      redeemSocketTicket: jest.fn(async (ticket: string) => ({
        bookingRequestId: BOOKING_ID,
        // Two different managers of the same organization.
        userId: ticket === "good" ? "manager-a" : "manager-b",
      })),
      authorizeStream: jest.fn(async () => ({
        bookingRequestId: BOOKING_ID,
        side: "owner",
        canWrite: true,
      })),
    });

    const first = await connect("good");
    await first.waitFor("ready");
    const second = await connect("other");
    await second.waitFor("ready");

    // Each socket joins and leaves the *side*, never a per-user key. Whether
    // that leaves the side empty is the shared count's answer, which is the
    // only one that stays right when the API runs on more than one replica —
    // this process's socket map cannot see a colleague on another instance.
    expect(fakes.join).toHaveBeenCalledTimes(2);
    expect(fakes.join).toHaveBeenCalledWith(
      BOOKING_ID,
      "owner",
      expect.any(String),
    );

    first.socket.close();
    await settle(30);
    expect(fakes.leave).toHaveBeenCalledTimes(1);
    expect(fakes.leave).toHaveBeenCalledWith(
      BOOKING_ID,
      "owner",
      expect.any(String),
    );

    second.socket.close();
    await settle(30);
    expect(fakes.leave).toHaveBeenCalledTimes(2);
  }, 20_000);

  it("sends the counterpart's current presence on connect", async () => {
    installFakeContainer({ isSideOnline: jest.fn(async () => true) });

    const connection = await connect();
    const presence = await connection.waitFor("presence");

    // The counterpart's own arrival was announced before this socket existed,
    // and a live key is never re-announced, so without this a newcomer would
    // show an active party as offline until they happened to reconnect.
    expect(presence).toMatchObject({
      type: "presence",
      bookingRequestId: BOOKING_ID,
      side: "owner",
      state: "online",
    });

    connection.socket.close();
  }, 20_000);

  it("reports the counterpart as offline when nobody is on that side", async () => {
    installFakeContainer({ isSideOnline: jest.fn(async () => false) });

    const connection = await connect();
    const presence = await connection.waitFor("presence");

    expect(presence).toMatchObject({ side: "owner", state: "offline" });

    connection.socket.close();
  }, 20_000);

  it("records delivery acknowledgements and ignores empty ones", async () => {
    const fakes = installFakeContainer();
    const { socket, waitFor } = await connect();
    await waitFor("ready");

    socket.send(JSON.stringify({ type: "delivered", messageIds: ["m1"] }));
    await settle();
    expect(fakes.markDelivered).toHaveBeenCalledWith(BOOKING_ID, USER_ID, [
      "m1",
    ]);

    socket.send(JSON.stringify({ type: "delivered", messageIds: [] }));
    socket.send(JSON.stringify({ type: "delivered", messageIds: [42] }));
    await settle();
    expect(fakes.markDelivered).toHaveBeenCalledTimes(1);

    socket.close();
  }, 20_000);

  it("survives a malformed frame", async () => {
    const fakes = installFakeContainer();
    const { socket, waitFor } = await connect();
    await waitFor("ready");

    socket.send("not json");
    await settle();

    // Still healthy: a bad frame is the client's problem, not grounds to drop.
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(fakes.markDelivered).not.toHaveBeenCalled();

    socket.close();
  }, 20_000);

  it("survives frames that parse to something that is not an object", async () => {
    const fakes = installFakeContainer();
    const { socket, waitFor } = await connect();
    await waitFor("ready");

    const unhandled: unknown[] = [];
    const captureRejection = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", captureRejection);

    try {
      // `null` is the dangerous one: JSON.parse accepts it, so reading `.type`
      // off the result throws outside the parse guard, inside an async handler
      // whose promise nobody awaits. Node's default policy turns that into a
      // process exit — a one-line denial of service available to any
      // authenticated client. The rest are here so the guard cannot be written
      // narrowly enough to pass while still letting one of them through.
      socket.send("null");
      socket.send("42");
      socket.send('"a string"');
      socket.send("[1,2,3]");
      socket.send("true");
      await settle(20);

      expect(unhandled).toEqual([]);
      expect(socket.readyState).toBe(WebSocket.OPEN);
      expect(fakes.markDelivered).not.toHaveBeenCalled();
      expect(fakes.publishTyping).not.toHaveBeenCalled();

      // Proves the connection is still usable, not merely un-crashed.
      socket.send(JSON.stringify({ type: "delivered", messageIds: ["m1"] }));
      await settle();
      expect(fakes.markDelivered).toHaveBeenCalledTimes(1);
    } finally {
      process.off("unhandledRejection", captureRejection);
      socket.close();
    }
  }, 20_000);

  it("releases the hub subscription and clears presence on close", async () => {
    const fakes = installFakeContainer();
    const { socket, waitFor } = await connect();
    await waitFor("ready");

    expect(socketServer.activeConnectionCount()).toBe(1);

    socket.close();
    await settle(30);

    expect(fakes.release).toHaveBeenCalled();
    expect(fakes.leave).toHaveBeenCalledWith(
      BOOKING_ID,
      "renter",
      expect.any(String),
    );
    expect(socketServer.activeConnectionCount()).toBe(0);
  }, 20_000);

  it("counts a second tab as its own arrival and departure", async () => {
    const fakes = installFakeContainer();
    const first = await connect();
    await first.waitFor("ready");
    const second = await connect();
    await second.waitFor("ready");

    first.socket.close();
    await settle(30);

    // Both tabs joined, so both leave. The side is still present after the
    // first goes because the count says so — one balanced pair per socket is
    // what keeps that count honest.
    expect(fakes.join).toHaveBeenCalledTimes(2);
    expect(fakes.leave).toHaveBeenCalledTimes(1);

    second.socket.close();
    await settle(30);
    expect(fakes.leave).toHaveBeenCalledTimes(2);
  }, 20_000);

  it("does not decrement a side it never joined", async () => {
    const fakes = installFakeContainer({
      authorizeStream: jest.fn(async () => {
        throw new Error("No access.");
      }),
    });

    const socket = new WebSocket(baseUrl, {
      headers: { cookie: "rentify_ws_ticket=good" },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    await settle(20);

    socket.close();
    await settle(30);

    // The capability lookup failed, so this socket never joined the side. A
    // decrement here would push the shared count below the number of live
    // sockets and take the side offline while people were still watching.
    expect(fakes.join).not.toHaveBeenCalled();
    expect(fakes.leave).not.toHaveBeenCalled();
  }, 20_000);

  /**
   * The periodic sweeps run on 20 and 60 second intervals, which no unit test
   * is going to wait for, and faking timers would break the real sockets these
   * tests use. They are driven directly instead — the alternative is leaving
   * the revocation paths, the ones that decide whether a signed-out user keeps
   * receiving messages, with no coverage at all.
   */
  function sweeps(server: BookingMessageSocketServer) {
    const internals = server as unknown as {
      reauthorizeAll(): Promise<void>;
      refreshPresenceAll(): Promise<void>;
      pingAll(): void;
    };

    return {
      reauthorize: () => internals.reauthorizeAll(),
      refreshPresence: () => internals.refreshPresenceAll(),
      ping: () => internals.pingAll(),
    };
  }

  it("keeps a socket open while membership and session both hold", async () => {
    const fakes = installFakeContainer();
    const connection = await connect();
    await connection.waitFor("ready");

    await sweeps(socketServer).reauthorize();

    expect(fakes.authorizeStream).toHaveBeenCalled();
    expect(fakes.assertSocketSessionValid).toHaveBeenCalled();
    expect(socketServer.activeConnectionCount()).toBe(1);

    connection.socket.close();
  }, 20_000);

  it("closes a socket whose membership was revoked", async () => {
    let calls = 0;
    const fakes = installFakeContainer({
      // Healthy at registration, revoked by the time the sweep comes round.
      // The two moments are different code paths and both have to close.
      authorizeStream: jest.fn(async () => {
        calls += 1;

        if (calls > 1) {
          throw new Error("No access.");
        }

        return { bookingRequestId: BOOKING_ID, side: "renter", canWrite: true };
      }),
    });
    const connection = await connect();
    await connection.waitFor("ready");
    expect(socketServer.activeConnectionCount()).toBe(1);

    await sweeps(socketServer).reauthorize();
    await settle(30);

    expect(socketServer.activeConnectionCount()).toBe(0);
    // The lease is given back rather than left to expire.
    expect(fakes.leave).toHaveBeenCalled();
  }, 20_000);

  it("closes a socket that lost access between the ticket and registration", async () => {
    const fakes = installFakeContainer({
      authorizeStream: jest.fn(async () => {
        throw new Error("No access.");
      }),
    });

    const socket = new WebSocket(baseUrl, {
      headers: { cookie: "rentify_ws_ticket=good" },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    await settle(40);

    // The upgrade already succeeded, so the only way to refuse someone who lost
    // access in the gap is to tear the socket down. Swallowing the failure left
    // it subscribed and streaming message bodies until the next sweep.
    expect(socketServer.activeConnectionCount()).toBe(0);
    expect(fakes.subscribe).not.toHaveBeenCalled();
    expect(fakes.join).not.toHaveBeenCalled();

    socket.terminate();
  }, 20_000);

  it("closes a socket whose session was revoked even though membership holds", async () => {
    const fakes = installFakeContainer({
      assertSocketSessionValid: jest.fn(async () => {
        throw new Error("Session is no longer valid.");
      }),
    });
    const connection = await connect();
    await connection.waitFor("ready");

    await sweeps(socketServer).reauthorize();
    await settle(30);

    // The membership check passes here. Without the session check this socket
    // would stay open, feeding message bodies to someone who has logged out
    // and whose every REST call is being rejected.
    expect(fakes.authorizeStream).toHaveBeenCalled();
    expect(socketServer.activeConnectionCount()).toBe(0);
  }, 20_000);

  it("pushes out presence for every open socket, and skips the work when idle", async () => {
    const fakes = installFakeContainer();

    // Nothing connected: the sweep must not resolve a scope it has no use for.
    await sweeps(socketServer).refreshPresence();
    expect(fakes.refresh).not.toHaveBeenCalled();

    const first = await connect();
    await first.waitFor("ready");
    const second = await connect();
    await second.waitFor("ready");
    fakes.refresh.mockClear();

    await sweeps(socketServer).refreshPresence();

    // One renewal per socket, deliberately not deduplicated per side: each
    // holds its own lease, and renewing the side as a whole would keep a dead
    // replica's lease alive forever.
    expect(fakes.refresh).toHaveBeenCalledTimes(2);
    expect(fakes.refresh).toHaveBeenCalledWith(
      BOOKING_ID,
      "renter",
      expect.any(String),
    );

    first.socket.close();
    second.socket.close();
  }, 20_000);

  it("drops a socket that missed a full heartbeat round", async () => {
    installFakeContainer();
    const connection = await connect();
    await connection.waitFor("ready");

    // First sweep marks it pending; the second finds no pong in between.
    sweeps(socketServer).ping();
    sweeps(socketServer).ping();
    await settle(30);

    expect(socketServer.activeConnectionCount()).toBe(0);
  }, 20_000);

  it("gives back presence leases when the server shuts down", async () => {
    const fakes = installFakeContainer();
    const connection = await connect();
    await connection.waitFor("ready");

    // What a rollout does. `close()` is reached through the container's dispose
    // hook, which the process shutdown path has to actually invoke — until it
    // did, every deploy dropped sockets without a close frame and left both
    // sides marked online until their leases expired.
    await socketServer.close();

    expect(fakes.leave).toHaveBeenCalledWith(
      BOOKING_ID,
      "renter",
      expect.any(String),
    );
    expect(fakes.release).toHaveBeenCalled();
    expect(socketServer.activeConnectionCount()).toBe(0);
  }, 20_000);

  it("releases the subscription when the peer vanishes mid-handshake", async () => {
    let releaseSubscription: () => Promise<void> = async () => undefined;
    const fakes = installFakeContainer({
      subscribe: jest.fn(async () => {
        // Slow enough that the client is gone before this resolves. Real
        // enough: subscribing talks to Redis.
        await new Promise((resolve) => setTimeout(resolve, 250));
        return releaseSubscription;
      }),
    });
    releaseSubscription = fakes.release;

    const socket = new WebSocket(baseUrl, {
      headers: { cookie: "rentify_ws_ticket=good" },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    // Aborted immediately. The close handler runs teardown while subscribe is
    // still pending, which drops the socket from the map — so the release
    // assigned afterwards had nothing left to call it, and the listener and its
    // Redis channel stayed for the life of the process.
    socket.terminate();
    await settle(50);

    expect(fakes.release).toHaveBeenCalledTimes(1);
    expect(socketServer.activeConnectionCount()).toBe(0);
  }, 20_000);

  it("closes the socket when the subscription cannot be established", async () => {
    installFakeContainer({
      subscribe: jest.fn(async () => {
        throw new Error("redis down");
      }),
    });

    const { socket } = await connect();
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));

    expect(socketServer.activeConnectionCount()).toBe(0);
  }, 20_000);
});
