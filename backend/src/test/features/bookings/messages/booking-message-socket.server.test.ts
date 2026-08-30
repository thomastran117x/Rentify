import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  io as createClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import {
  createRootContainer,
  setContainer,
} from "@/configuration/bootstrap/container";
import { containerTokens } from "@/configuration/container/tokens";
import {
  BOOKING_MESSAGE_SOCKET_PATH,
  BookingMessageSocketServer,
} from "@/features/bookings/messages/booking-message-socket.server";
import { testUuid } from "../../../support/uuid";

const BOOKING_ID = testUuid(1020, 1);
const USER_ID = testUuid(1000, 1);
const MESSAGE_ID = testUuid(1030, 1);

interface Fakes {
  redeemSocketTicket: jest.Mock;
  authorizeStream: jest.Mock;
  assertSocketSessionValid: jest.Mock;
  markDelivered: jest.Mock;
  findUserById: jest.Mock;
}

/**
 * A container of fakes, so the gateway's own logic — handshake authorization,
 * room membership, throttling, teardown — is exercised without infrastructure.
 * The Redis adapter is deliberately absent: a single instance works without it,
 * and the cross-instance behaviour it provides belongs to the integration
 * suite, where a real Redis is available.
 */
function installFakeContainer(overrides: Partial<Fakes> = {}): Fakes {
  const fakes: Fakes = {
    // The ticket selects the side, so a test can put a genuine counterpart on
    // the thread rather than two sockets that both look like the same party.
    redeemSocketTicket:
      overrides.redeemSocketTicket ??
      jest.fn(async (ticket: string) => {
        if (ticket === "good") {
          return { bookingRequestId: BOOKING_ID, userId: USER_ID };
        }

        if (ticket === "owner") {
          return { bookingRequestId: BOOKING_ID, userId: "owner-1" };
        }

        return null;
      }),
    authorizeStream:
      overrides.authorizeStream ??
      jest.fn(async (_bookingRequestId: string, userId: string) => ({
        bookingRequestId: BOOKING_ID,
        side: userId === "owner-1" ? "owner" : "renter",
        canWrite: true,
      })),
    assertSocketSessionValid:
      overrides.assertSocketSessionValid ?? jest.fn(async () => undefined),
    markDelivered: overrides.markDelivered ?? jest.fn(async () => ["m1"]),
    findUserById:
      overrides.findUserById ??
      jest.fn(async () => ({ profile: { username: "renter-one" } })),
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
    token: containerTokens.authUsersRepository,
    lifetime: "scoped",
    dependencies: [],
    resolve: () => ({ findUserById: fakes.findUserById }) as never,
  });

  setContainer(container);
  return fakes;
}

describe("BookingMessageSocketServer", () => {
  let socketServer: BookingMessageSocketServer;
  let httpServer: Server;
  let port: number;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    socketServer = new BookingMessageSocketServer();
    httpServer = createServer((request, response) => {
      if (request.url === "/slow") {
        // Deliberately never answered: the shutdown test needs a connection
        // that is serving a request, which is what a rolling deploy has.
        return;
      }

      response.writeHead(404);
      response.end();
    });
    await socketServer.attach(httpServer);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }

    await socketServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  /**
   * A real Socket.IO client against the real gateway. The ticket rides in a
   * cookie exactly as the browser sends it — `extraHeaders` is how a Node
   * client supplies one.
   */
  function client(ticket = "good"): ClientSocket {
    const socket = createClient(`http://127.0.0.1:${port}`, {
      path: BOOKING_MESSAGE_SOCKET_PATH,
      extraHeaders: { cookie: `rentify_ws_ticket=${ticket}` },
      reconnection: false,
      // Websocket only here so a failed handshake surfaces immediately rather
      // than after polling retries; both transports are exercised in the
      // integration suite.
      transports: ["websocket"],
    });

    clients.push(socket);
    return socket;
  }

  async function connected(ticket = "good"): Promise<ClientSocket> {
    const socket = client(ticket);

    await new Promise<void>((resolve, reject) => {
      socket.once("ready", () => resolve());
      socket.once("connect_error", reject);
    });

    return socket;
  }

  function nextEvent<T = Record<string, unknown>>(
    socket: ClientSocket,
    name: string,
    match: (event: T) => boolean = () => true,
    timeoutMs = 8_000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for "${name}".`)),
        timeoutMs,
      );

      const listener = (event: T) => {
        if (!match(event)) {
          return;
        }

        clearTimeout(timer);
        socket.off(name, listener);
        resolve(event);
      };

      socket.on(name, listener);
    });
  }

  async function settle(times = 12): Promise<void> {
    for (let index = 0; index < times; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it("accepts a valid ticket and announces readiness", async () => {
    const fakes = installFakeContainer();
    const socket = client();

    const ready = await nextEvent(socket, "ready");

    expect(ready).toMatchObject({ bookingRequestId: BOOKING_ID });
    expect(fakes.redeemSocketTicket).toHaveBeenCalledWith("good");
    expect(socketServer.activeConnectionCount()).toBe(1);
  }, 20_000);

  it("refuses a handshake whose ticket does not redeem", async () => {
    installFakeContainer();
    const socket = client("bad");

    const error = await new Promise<Error>((resolve) =>
      socket.once("connect_error", resolve),
    );

    expect(error.message).toBe("Unauthorized");
    expect(socketServer.activeConnectionCount()).toBe(0);
  }, 20_000);

  it("refuses a handshake with no ticket cookie at all", async () => {
    const fakes = installFakeContainer();
    const socket = createClient(`http://127.0.0.1:${port}`, {
      path: BOOKING_MESSAGE_SOCKET_PATH,
      reconnection: false,
      transports: ["websocket"],
    });
    clients.push(socket);

    const error = await new Promise<Error>((resolve) =>
      socket.once("connect_error", resolve),
    );

    expect(error.message).toBe("Unauthorized");
    expect(fakes.redeemSocketTicket).toHaveBeenCalledWith("");
  }, 20_000);

  it("refuses a participant who lost access before the handshake", async () => {
    const fakes = installFakeContainer({
      authorizeStream: jest.fn(async () => {
        throw new Error("No access.");
      }),
    });
    const socket = client();

    const error = await new Promise<Error>((resolve) =>
      socket.once("connect_error", resolve),
    );

    // Rejected in the handshake rather than admitted and torn down, so a
    // participant who lost access in the ticket's window never reaches a room.
    expect(error.message).toBe("Unauthorized");
    expect(fakes.markDelivered).not.toHaveBeenCalled();
    expect(socketServer.activeConnectionCount()).toBe(0);
  }, 20_000);

  it("delivers a published event to everyone in the thread", async () => {
    installFakeContainer();
    const socket = await connected();

    const received = nextEvent(socket, "message.created");
    socketServer.publish({
      type: "message.created",
      bookingRequestId: BOOKING_ID,
      message: { id: "m1" },
    } as never);

    expect(await received).toMatchObject({ bookingRequestId: BOOKING_ID });
  }, 20_000);

  it("announces online on every arrival, not only the first", async () => {
    installFakeContainer();
    // Listener attached before the handshake completes: presence follows
    // `ready` immediately, so waiting for `ready` first would miss it.
    const first = client();
    const presence = await nextEvent(
      first,
      "presence",
      (event: Record<string, unknown>) =>
        event.side === "renter" && event.state === "online",
    );
    expect(presence).toMatchObject({ side: "renter", state: "online" });

    // Deliberately not edge-detected. Detecting "am I the first?" needs a room
    // count, and that count is an async cluster round trip: two sockets joining
    // the same side at once can both see a size of two, both conclude they are
    // not first, and leave the counterpart stuck on offline. Presence is a
    // state, so re-announcing it is idempotent and race-free.
    const seen: unknown[] = [];
    first.on("presence", (event: Record<string, unknown>) => {
      if (event.side === "renter" && event.state === "online") {
        seen.push(event);
      }
    });

    await connected();
    await settle(20);

    expect(seen).toHaveLength(1);
  }, 20_000);

  it("tells a socket to resync when its write capability changes", async () => {
    let calls = 0;
    installFakeContainer({
      // Manager at the handshake, operator by the time the sweep runs.
      authorizeStream: jest.fn(async () => {
        calls += 1;

        return {
          bookingRequestId: BOOKING_ID,
          side: "renter",
          canWrite: calls === 1,
        };
      }),
    });
    const socket = await connected();
    const resync = nextEvent(socket, "resync");

    await (
      socketServer as unknown as { reauthorizeAll(): Promise<void> }
    ).reauthorizeAll();

    // The server refusing their writes is not enough on its own: the panel
    // caches the capability from the thread response, so without this it keeps
    // offering a composer that can only produce 403s.
    expect(await resync).toMatchObject({ bookingRequestId: BOOKING_ID });
    expect(socket.connected).toBe(true);
  }, 20_000);

  it("stays quiet when the capability is unchanged", async () => {
    installFakeContainer();
    const socket = await connected();

    let resyncs = 0;
    socket.on("resync", () => {
      resyncs += 1;
    });

    await (
      socketServer as unknown as { reauthorizeAll(): Promise<void> }
    ).reauthorizeAll();
    await settle(20);

    // The sweep runs every minute; re-announcing an unchanged capability would
    // make every client refetch the thread on a timer.
    expect(resyncs).toBe(0);
  }, 20_000);

  it("tells a joiner the counterpart's current presence", async () => {
    installFakeContainer();
    const socket = client();

    // Nobody is on the owner side, so the snapshot has to say so — without it a
    // client that joined second would show an active party as offline forever,
    // since a presence that has not changed is never re-announced.
    const snapshot = await nextEvent(
      socket,
      "presence",
      (event: Record<string, unknown>) => event.side === "owner",
    );

    expect(snapshot).toMatchObject({ side: "owner", state: "offline" });
  }, 20_000);

  it("announces offline when the last socket on a side goes", async () => {
    installFakeContainer();
    // The observer has to be on the *other* side: a side is told about its
    // counterpart's presence, and two sockets on one side would mean the first
    // leaving is not a transition at all.
    const watcher = await connected("owner");
    const leaving = await connected("good");

    const offline = nextEvent(
      watcher,
      "presence",
      (event: Record<string, unknown>) =>
        event.side === "renter" && event.state === "offline",
    );

    leaving.disconnect();

    expect(await offline).toMatchObject({ side: "renter", state: "offline" });
  }, 20_000);

  it("throttles typing and drops it from a participant who cannot write", async () => {
    const fakes = installFakeContainer();
    const socket = await connected();

    const typing = nextEvent(socket, "typing");
    socket.emit("typing");
    socket.emit("typing");
    socket.emit("typing");

    expect(await typing).toMatchObject({ username: "renter-one" });
    await settle(20);

    // One lookup, not three: a client ignoring its own throttle must not be
    // able to flood the thread.
    expect(fakes.findUserById).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("ignores typing from a participant who may only read", async () => {
    const fakes = installFakeContainer({
      authorizeStream: jest.fn(async () => ({
        bookingRequestId: BOOKING_ID,
        side: "owner",
        canWrite: false,
      })),
    });
    const socket = await connected();

    socket.emit("typing");
    await settle(20);

    // An organization operator connects legitimately — the UI simply withholds
    // their composer — but nothing stops them emitting this by hand, and the
    // renter would see someone who cannot reply appear to be typing.
    expect(fakes.findUserById).not.toHaveBeenCalled();
    expect(socket.connected).toBe(true);
  }, 20_000);

  it("records delivery acknowledgements and ignores malformed ones", async () => {
    const fakes = installFakeContainer();
    const socket = await connected();

    socket.emit("delivered", [MESSAGE_ID]);
    await settle(20);
    expect(fakes.markDelivered).toHaveBeenCalledWith(BOOKING_ID, USER_ID, [
      MESSAGE_ID,
    ]);

    socket.emit("delivered", []);
    socket.emit("delivered", [42]);
    socket.emit("delivered", "nonsense");
    socket.emit("delivered", null);
    // A well-formed array whose entries are not identifiers: the payload is
    // untrusted, so these are dropped rather than passed to the service.
    socket.emit("delivered", ["m1"]);
    await settle(20);

    expect(fakes.markDelivered).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(true);
  }, 20_000);

  it("closes a socket whose access was revoked while it was open", async () => {
    let calls = 0;
    const fakes = installFakeContainer({
      // Healthy at the handshake, revoked by the time the sweep comes round.
      authorizeStream: jest.fn(async () => {
        calls += 1;

        if (calls > 1) {
          throw new Error("No access.");
        }

        return { bookingRequestId: BOOKING_ID, side: "renter", canWrite: true };
      }),
    });
    const socket = await connected();

    const closed = new Promise<void>((resolve) =>
      socket.once("disconnect", () => resolve()),
    );

    await (
      socketServer as unknown as { reauthorizeAll(): Promise<void> }
    ).reauthorizeAll();
    await closed;

    expect(fakes.authorizeStream).toHaveBeenCalledTimes(2);
    expect(socketServer.activeConnectionCount()).toBe(0);
  }, 20_000);

  it("closes a socket whose session was revoked even though membership holds", async () => {
    const fakes = installFakeContainer({
      assertSocketSessionValid: jest.fn(async () => {
        throw new Error("Session is no longer valid.");
      }),
    });
    const socket = await connected();

    const closed = new Promise<void>((resolve) =>
      socket.once("disconnect", () => resolve()),
    );

    await (
      socketServer as unknown as { reauthorizeAll(): Promise<void> }
    ).reauthorizeAll();
    await closed;

    // Membership still passes here. Without the session check this socket would
    // stay open, feeding message bodies to someone who has logged out and whose
    // every REST call is being rejected.
    expect(fakes.authorizeStream).toHaveBeenCalled();
    expect(socketServer.activeConnectionCount()).toBe(0);
  }, 20_000);

  it("closes even with a request in flight on the same server", async () => {
    installFakeContainer();
    const socket = await connected();

    // The http server is closed first, exactly as the process shutdown does,
    // and a request is left hanging. `io.close()` would delegate to
    // `httpServer.close(cb)`; that second close waits on a `close` event which
    // cannot fire while a connection is serving a request, so the await never
    // settled and every rolling deploy hung until the container was killed.
    // `closeIdleConnections()` cannot rescue it either — that connection is not
    // idle, which is the whole point.
    const abort = new AbortController();
    const inFlight = fetch(`http://127.0.0.1:${port}/slow`, {
      signal: abort.signal,
    }).catch(() => undefined);
    await settle(10);
    httpServer.close();

    const clientClosed = new Promise<void>((resolve) =>
      socket.once("disconnect", () => resolve()),
    );

    const outcome = await Promise.race([
      socketServer.close().then(() => "closed"),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 4_000)),
    ]);

    expect(outcome).toBe("closed");

    // The client is told, rather than merely dropped when the process exits.
    await clientClosed;
    expect(socket.connected).toBe(false);

    abort.abort();
    await inFlight;
    httpServer.closeAllConnections();
  }, 20_000);

  it("disconnects everyone when the server closes", async () => {
    installFakeContainer();
    const socket = await connected();

    const closed = new Promise<void>((resolve) =>
      socket.once("disconnect", () => resolve()),
    );

    // What a rollout does, reached through the container's dispose hook.
    await socketServer.close();
    await closed;

    expect(socketServer.activeConnectionCount()).toBe(0);
  }, 20_000);
});
