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
import { asUuid } from "@/configuration/validation/uuid";
import { mediaStatusRoom } from "@/features/media/media.model";
import { Adapter } from "socket.io-adapter";
import {
  MEDIA_STATUS_SOCKET_PATH,
  MEDIA_STATUS_UNAVAILABLE,
  MediaStatusSocketServer,
  type MediaStatusAdapterBuilder,
} from "@/features/media/media-status-socket.server";
import { testUuid } from "../../support/uuid";

const USER_ID = testUuid(9000, 994430);
const OTHER_USER_ID = testUuid(9000, 994431);

interface Fakes {
  redeemSocketTicket: jest.Mock;
  assertSocketSessionValid: jest.Mock;
}

/**
 * Socket.IO's own in-memory adapter, in place of the Redis one: rooms work on
 * a single instance, and delivery across Redis is the integration suite's.
 */
const inMemoryAdapter: MediaStatusAdapterBuilder = async () => ({
  adapter: Adapter,
  clients: [],
});

/**
 * A container of fakes, so the gateway's own logic - the handshake, the room
 * it joins, the session sweep and teardown - runs without infrastructure.
 */
function installFakeContainer(overrides: Partial<Fakes> = {}): Fakes {
  const fakes: Fakes = {
    redeemSocketTicket:
      overrides.redeemSocketTicket ??
      jest.fn(async (ticket: string) => {
        const userId = { good: USER_ID, other: OTHER_USER_ID }[ticket];

        return userId
          ? { userId, sessionId: `session-${ticket}`, tokenVersion: 1 }
          : null;
      }),
    assertSocketSessionValid:
      overrides.assertSocketSessionValid ?? jest.fn(async () => undefined),
  };
  const container = createRootContainer();

  container.register({
    token: containerTokens.mediaStatusSocketService,
    lifetime: "scoped",
    dependencies: [],
    resolve: () =>
      ({
        redeemSocketTicket: fakes.redeemSocketTicket,
        assertSocketSessionValid: fakes.assertSocketSessionValid,
      }) as never,
  });

  setContainer(container);
  return fakes;
}

describe("MediaStatusSocketServer", () => {
  let socketServer: MediaStatusSocketServer;
  let httpServer: Server;
  let port: number;
  const clients: ClientSocket[] = [];

  async function start(buildAdapter: MediaStatusAdapterBuilder): Promise<void> {
    socketServer = new MediaStatusSocketServer(buildAdapter);
    httpServer = createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    await socketServer.attach(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  }

  beforeEach(async () => {
    await start(inMemoryAdapter);
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }

    await socketServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  function client(ticket: string): ClientSocket {
    const socket = createClient(`http://127.0.0.1:${port}`, {
      path: MEDIA_STATUS_SOCKET_PATH,
      extraHeaders: { cookie: `rentify_media_ws_ticket=${ticket}` },
      reconnection: false,
      transports: ["websocket"],
      forceNew: true,
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

  function disconnected(socket: ClientSocket): Promise<void> {
    return new Promise((resolve) => socket.once("disconnect", () => resolve()));
  }

  async function roomSize(userId: string): Promise<number> {
    const io = socketServer["io"]!;
    return (await io.in(mediaStatusRoom(asUuid(userId))).fetchSockets()).length;
  }

  it("admits a ticket's user into their own room only", async () => {
    const fakes = installFakeContainer();

    await connected("good");
    await connected("good");
    await connected("other");

    expect(fakes.redeemSocketTicket).toHaveBeenCalledWith("good");
    expect(socketServer.activeConnectionCount()).toBe(3);
    await expect(roomSize(USER_ID)).resolves.toBe(2);
    await expect(roomSize(OTHER_USER_ID)).resolves.toBe(1);
  });

  it("delivers what is sent to a user's room", async () => {
    installFakeContainer();
    const socket = await connected("good");
    const received = new Promise((resolve) =>
      socket.once("media.status", resolve),
    );

    socketServer["io"]!.to(mediaStatusRoom(asUuid(USER_ID))).emit(
      "media.status",
      {
        mediaId: "m-1",
        status: "ready",
      },
    );

    await expect(received).resolves.toEqual({
      mediaId: "m-1",
      status: "ready",
    });
  });

  it.each([
    ["an unknown ticket", "nope", undefined],
    ["no ticket", "", undefined],
    [
      "a failing redemption",
      "good",
      jest.fn(async () => {
        throw new Error("cache unavailable");
      }),
    ],
  ])("refuses a handshake with %s", async (_case, ticket, redeem) => {
    installFakeContainer(redeem ? { redeemSocketTicket: redeem } : {});

    const error = await new Promise<Error>((resolve) => {
      client(ticket).once("connect_error", resolve);
    });

    expect(error.message).toBe("Unauthorized");
    expect(socketServer.activeConnectionCount()).toBe(0);
  });

  it("refuses every handshake as unavailable when it has no adapter for the worker's pushes", async () => {
    await socketServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await start(async () => ({ adapter: null, clients: [] }));
    const fakes = installFakeContainer();

    const error = await new Promise<Error>((resolve) => {
      client("good").once("connect_error", resolve);
    });

    expect(error.message).toBe(MEDIA_STATUS_UNAVAILABLE);
    // Refused before the ticket is spent.
    expect(fakes.redeemSocketTicket).not.toHaveBeenCalled();
    expect(socketServer.activeConnectionCount()).toBe(0);
  });

  it("closes a socket whose session has ended, and keeps the rest", async () => {
    const assertSocketSessionValid = jest.fn(
      async (identity: { userId: string }) => {
        if (identity.userId === USER_ID) {
          throw new Error("Session has been revoked.");
        }
      },
    );
    installFakeContainer({ assertSocketSessionValid });
    const revoked = await connected("good");
    await connected("other");
    const closed = disconnected(revoked);

    await socketServer["reauthorizeAll"]();

    await closed;
    expect(socketServer.activeConnectionCount()).toBe(1);
    expect(assertSocketSessionValid).toHaveBeenCalledTimes(2);
  });

  it("disconnects every socket on close", async () => {
    installFakeContainer();
    const socket = await connected("good");
    const closed = disconnected(socket);

    await socketServer.close();

    await closed;
    expect(socketServer.activeConnectionCount()).toBe(0);
  });
});
