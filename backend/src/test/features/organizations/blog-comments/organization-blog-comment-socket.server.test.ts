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
  BLOG_COMMENT_SOCKET_PATH,
  OrganizationBlogCommentSocketServer,
} from "@/features/organizations/blog-comments/organization-blog-comment-socket.server";

const POST_ID = "blog-1";
const ORG_ID = "org-1";
const USER_ID = "user-1";

interface Fakes {
  redeemSocketTicket: jest.Mock;
  authorizeStream: jest.Mock;
  assertSocketSessionValid: jest.Mock;
  findUserById: jest.Mock;
}

/**
 * A container of fakes, so the gateway's own logic — handshake authorization,
 * room membership, presence coalescing, throttling, teardown — is exercised
 * without infrastructure. The Redis adapter is deliberately absent: a single
 * instance works without it, and the cross-instance behaviour belongs to the
 * integration suite where a real Redis is available.
 */
function installFakeContainer(overrides: Partial<Fakes> = {}): Fakes {
  const fakes: Fakes = {
    // The ticket carries identity, so a test can put a genuine anonymous
    // reader and a signed-in author in the same room.
    redeemSocketTicket:
      overrides.redeemSocketTicket ??
      jest.fn(async (ticket: string) => {
        if (ticket === "good") {
          return {
            blogPostId: POST_ID,
            organizationId: ORG_ID,
            userId: USER_ID,
            sessionId: "session-1",
            tokenVersion: 1,
          };
        }

        if (ticket === "anonymous") {
          return {
            blogPostId: POST_ID,
            organizationId: ORG_ID,
            userId: null,
            sessionId: null,
            tokenVersion: null,
          };
        }

        return null;
      }),
    authorizeStream:
      overrides.authorizeStream ??
      jest.fn(async (_blogPostId: string, userId: string | null) => ({
        blogPostId: POST_ID,
        organizationId: ORG_ID,
        canWrite: Boolean(userId),
        canModerate: false,
      })),
    assertSocketSessionValid:
      overrides.assertSocketSessionValid ?? jest.fn(async () => undefined),
    findUserById:
      overrides.findUserById ??
      jest.fn(async () => ({ profile: { username: "renter-one" } })),
  };

  const container = createRootContainer();

  container.register({
    token: containerTokens.organizationBlogCommentsService,
    lifetime: "scoped",
    dependencies: [],
    resolve: () =>
      ({
        redeemSocketTicket: fakes.redeemSocketTicket,
        authorizeStream: fakes.authorizeStream,
        assertSocketSessionValid: fakes.assertSocketSessionValid,
      }) as never,
  });
  container.register({
    token: containerTokens.authRepository,
    lifetime: "scoped",
    dependencies: [],
    resolve: () => ({ findUserById: fakes.findUserById }) as never,
  });

  setContainer(container);
  return fakes;
}

describe("OrganizationBlogCommentSocketServer", () => {
  let socketServer: OrganizationBlogCommentSocketServer;
  let httpServer: Server;
  let port: number;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    socketServer = new OrganizationBlogCommentSocketServer();
    httpServer = createServer((_request, response) => {
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
      path: BLOG_COMMENT_SOCKET_PATH,
      extraHeaders: { cookie: `rentify_blog_ws_ticket=${ticket}` },
      reconnection: false,
      // Websocket only here so a failed handshake surfaces immediately rather
      // than after polling retries.
      transports: ["websocket"],
      // Each client gets its own Manager. `socket.io-client` caches Managers by
      // origin rather than by path, so without this a second connection could
      // silently reuse the first's transport.
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

  it("admits a signed-in reader and reports write access", async () => {
    installFakeContainer();
    const socket = client();

    const ready = await nextEvent<{ blogPostId: string; canWrite: boolean }>(
      socket,
      "ready",
    );

    expect(ready.blogPostId).toBe(POST_ID);
    expect(ready.canWrite).toBe(true);
  });

  it("admits an anonymous reader read-only", async () => {
    installFakeContainer();
    const socket = client("anonymous");

    const ready = await nextEvent<{ canWrite: boolean }>(socket, "ready");

    // The whole point of the public surface: no session, still connected.
    expect(ready.canWrite).toBe(false);
  });

  it("rejects a handshake carrying no cookie at all", async () => {
    const fakes = installFakeContainer();
    const socket = createClient(`http://127.0.0.1:${port}`, {
      path: BLOG_COMMENT_SOCKET_PATH,
      reconnection: false,
      transports: ["websocket"],
      forceNew: true,
    });
    clients.push(socket);

    const error = await new Promise<Error>((resolve) => {
      socket.once("connect_error", resolve);
    });

    expect(error.message).toBe("Unauthorized");
    expect(fakes.redeemSocketTicket).toHaveBeenCalledWith("");
  });

  it("ignores unrelated and malformed cookie segments", async () => {
    const fakes = installFakeContainer();
    const socket = createClient(`http://127.0.0.1:${port}`, {
      path: BLOG_COMMENT_SOCKET_PATH,
      extraHeaders: {
        // A bare segment with no `=`, another gateway's cookie, then ours.
        cookie: `flag; rentify_ws_ticket=other; rentify_blog_ws_ticket=good`,
      },
      reconnection: false,
      transports: ["websocket"],
      forceNew: true,
    });
    clients.push(socket);

    await new Promise<void>((resolve, reject) => {
      socket.once("ready", () => resolve());
      socket.once("connect_error", reject);
    });

    // The booking gateway's ticket must never be mistaken for this one.
    expect(fakes.redeemSocketTicket).toHaveBeenCalledWith("good");
  });

  it("rejects a handshake when the gateway's own cookie is absent", async () => {
    const fakes = installFakeContainer();
    const socket = createClient(`http://127.0.0.1:${port}`, {
      path: BLOG_COMMENT_SOCKET_PATH,
      extraHeaders: { cookie: "rentify_ws_ticket=good" },
      reconnection: false,
      transports: ["websocket"],
      forceNew: true,
    });
    clients.push(socket);

    const error = await new Promise<Error>((resolve) => {
      socket.once("connect_error", resolve);
    });

    expect(error.message).toBe("Unauthorized");
    expect(fakes.redeemSocketTicket).toHaveBeenCalledWith("");
  });

  it("rejects a handshake when authorization throws", async () => {
    const fakes = installFakeContainer();
    fakes.authorizeStream.mockRejectedValue(new Error("Not found"));
    const socket = client();

    const error = await new Promise<Error>((resolve) => {
      socket.once("connect_error", resolve);
    });

    expect(error.message).toBe("Unauthorized");
  });

  it("rejects a handshake with no usable ticket", async () => {
    installFakeContainer();
    const socket = client("bogus");

    const error = await new Promise<Error>((resolve) => {
      socket.once("connect_error", resolve);
    });

    expect(error.message).toBe("Unauthorized");
    expect(socketServer.activeConnectionCount()).toBe(0);
  });

  it("delivers a published comment to every reader in the room", async () => {
    installFakeContainer();
    const author = await connected("good");
    const reader = await connected("anonymous");

    const arrival = nextEvent<{ comment: { id: string } }>(
      reader,
      "comment.created",
    );

    socketServer.publish({
      type: "comment.created",
      blogPostId: POST_ID,
      comment: { id: "comment-1" } as never,
    });

    await expect(arrival).resolves.toMatchObject({
      comment: { id: "comment-1" },
    });
    expect(author.connected).toBe(true);
  });

  it("does not deliver events for a different post", async () => {
    installFakeContainer();
    const reader = await connected();
    const seen: unknown[] = [];
    reader.on("comment.created", (event: unknown) => seen.push(event));

    socketServer.publish({
      type: "comment.created",
      blogPostId: "blog-other",
      comment: { id: "comment-9" } as never,
    });

    await settle();

    expect(seen).toHaveLength(0);
  });

  it("counts every reader in the room, anonymous included", async () => {
    installFakeContainer();
    await connected("good");
    await connected("anonymous");

    await expect(socketServer.countReaders(POST_ID)).resolves.toBe(2);
  });

  it("broadcasts a settled reader count after a burst of arrivals", async () => {
    installFakeContainer();
    const first = await connected("good");

    const counts: number[] = [];
    first.on("presence", (event: { readerCount: number }) => {
      counts.push(event.readerCount);
    });

    // Three more arrivals inside one coalescing window.
    await connected("anonymous");
    await connected("anonymous");
    await connected("anonymous");

    const presence = await nextEvent<{ readerCount: number }>(
      first,
      "presence",
      (event) => event.readerCount === 4,
    );

    expect(presence.readerCount).toBe(4);
    // Coalesced rather than one broadcast per join: four arrivals must not
    // cost four cluster round trips.
    expect(counts.length).toBeLessThan(4);
  });

  it("recounts after a reader leaves", async () => {
    installFakeContainer();
    const stayer = await connected("good");
    const leaver = await connected("anonymous");

    await nextEvent<{ readerCount: number }>(
      stayer,
      "presence",
      (event) => event.readerCount === 2,
    );

    leaver.disconnect();

    const presence = await nextEvent<{ readerCount: number }>(
      stayer,
      "presence",
      (event) => event.readerCount === 1,
    );

    expect(presence.readerCount).toBe(1);
  });

  it("relays a typing frame from a reader who may write", async () => {
    installFakeContainer();
    const author = await connected("good");
    const reader = await connected("anonymous");

    const typing = nextEvent<{ username: string }>(reader, "typing");
    author.emit("typing");

    await expect(typing).resolves.toMatchObject({ username: "renter-one" });
  });

  it("drops a typing frame from an anonymous reader", async () => {
    const fakes = installFakeContainer();
    const signedIn = await connected("good");
    const anonymous = await connected("anonymous");

    const seen: unknown[] = [];
    signedIn.on("typing", (event: unknown) => seen.push(event));

    // Nothing stops a client emitting this by hand; everyone else would see
    // someone who cannot post appear to be writing.
    anonymous.emit("typing");
    await settle();

    expect(seen).toHaveLength(0);
    expect(fakes.findUserById).not.toHaveBeenCalled();
  });

  it("throttles typing frames server-side", async () => {
    const fakes = installFakeContainer();
    const author = await connected("good");
    const reader = await connected("anonymous");

    const first = nextEvent(reader, "typing");
    author.emit("typing");
    await first;

    // A client ignoring its own throttle must not be able to flood the room.
    author.emit("typing");
    author.emit("typing");
    await settle();

    expect(fakes.findUserById).toHaveBeenCalledTimes(1);
  });

  it("disconnects a socket once its post stops being readable", async () => {
    const fakes = installFakeContainer();
    const socket = await connected();

    fakes.authorizeStream.mockRejectedValue(new Error("Not found"));
    await socketServer["reauthorizeAll"]();
    await settle();

    expect(socket.connected).toBe(false);
  });

  it("disconnects a signed-in socket whose session was revoked", async () => {
    const fakes = installFakeContainer();
    const socket = await connected("good");

    fakes.assertSocketSessionValid.mockRejectedValue(new Error("Revoked"));
    await socketServer["reauthorizeAll"]();
    await settle();

    expect(socket.connected).toBe(false);
  });

  it("keeps an anonymous socket when session checks are skipped", async () => {
    const fakes = installFakeContainer();
    const socket = await connected("anonymous");

    await socketServer["reauthorizeAll"]();
    await settle();

    expect(socket.connected).toBe(true);
    // An anonymous identity has no session to invalidate, so the sweep must
    // reach the check with a null user rather than failing closed.
    expect(fakes.assertSocketSessionValid).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null }),
    );
  });

  it("asks a socket to resync when its write capability changes", async () => {
    const fakes = installFakeContainer();
    const socket = await connected("good");

    const resync = nextEvent<{ blogPostId: string }>(socket, "resync");
    fakes.authorizeStream.mockResolvedValue({
      blogPostId: POST_ID,
      organizationId: ORG_ID,
      canWrite: false,
      canModerate: false,
    });
    await socketServer["reauthorizeAll"]();

    await expect(resync).resolves.toMatchObject({ blogPostId: POST_ID });
    expect(socket.connected).toBe(true);
  });

  it("stays quiet when the sweep finds nothing changed", async () => {
    installFakeContainer();
    const socket = await connected();
    const seen: unknown[] = [];
    socket.on("resync", (event: unknown) => seen.push(event));

    await socketServer["reauthorizeAll"]();
    await settle();

    expect(seen).toHaveLength(0);
  });

  it("disconnects every socket on close", async () => {
    installFakeContainer();
    const first = await connected("good");
    const second = await connected("anonymous");

    await socketServer.close();
    await settle();

    expect(first.connected).toBe(false);
    expect(second.connected).toBe(false);
    expect(socketServer.activeConnectionCount()).toBe(0);
  });

  it("reports no readers once the server is closed", async () => {
    installFakeContainer();
    await connected();

    await socketServer.close();

    await expect(socketServer.countReaders(POST_ID)).resolves.toBe(0);
  });
});
