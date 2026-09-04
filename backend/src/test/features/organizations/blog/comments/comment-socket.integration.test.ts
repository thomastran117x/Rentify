import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import {
  io as createClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import { containerTokens } from "@/configuration/container/tokens";
import { buildApiPath } from "@/configuration/http/api-path";
import { createFixtureId } from "@/seeds/types";
import {
  BLOG_COMMENT_SOCKET_PATH,
  OrganizationBlogCommentSocketServer,
} from "@/features/organizations/blog/comments/comment-socket.server";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../../../support/persistence-test-app";
import { asUuid } from "@/configuration/validation/uuid";

const ORGANIZATION_ID = createFixtureId(1040, 1);
const OPEN_SLUG = "introducing-weekend-stays";
const RENTER_EMAIL = "user1@rentify.local";
const OWNER_EMAIL = "owner1@rentify.local";

interface SocketEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Collects events so a test can await one without racing the socket. Socket.IO
 * delivers named events rather than one message stream, so every event the
 * gateway can emit is subscribed up front.
 */
const COLLECTED_EVENTS = [
  "ready",
  "comment.created",
  "comment.updated",
  "comment.deleted",
  "typing",
  "presence",
  "comments.closed",
  "resync",
] as const;

function collectFrames(socket: ClientSocket) {
  const frames: SocketEvent[] = [];

  for (const name of COLLECTED_EVENTS) {
    socket.on(name, (event: SocketEvent) => {
      frames.push({ ...event, type: event?.type ?? name });
    });
  }

  return {
    frames,
    async waitFor(
      type: string,
      match: (frame: SocketEvent) => boolean = () => true,
      timeoutMs = 10_000,
    ): Promise<SocketEvent> {
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        const found = frames.find(
          (frame) => frame.type === type && match(frame),
        );

        if (found) {
          return found;
        }

        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      throw new Error(
        `Timed out waiting for a "${type}" event. Saw: ${frames
          .map((frame) => frame.type)
          .join(", ")}`,
      );
    },
  };
}

type ConnectedSocket = ClientSocket & ReturnType<typeof collectFrames>;

describe("Organization blog comment socket integration", () => {
  let persistenceApp: PersistenceTestApp;
  let socketServer: OrganizationBlogCommentSocketServer;
  let httpServer: Server;
  let baseUrl: string;
  const sockets: ClientSocket[] = [];

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();

    // A bare HTTP server is enough: only the upgrade path is exercised here,
    // and REST calls still go through app.request in-process.
    httpServer = createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });

    // Resolved from the container rather than constructed here: the REST
    // handlers publish through the instance the container holds, and a second
    // instance would never see their events.
    socketServer = persistenceApp.container.resolve(
      containerTokens.organizationBlogCommentSocketServer,
    );
    await socketServer.attach(httpServer);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }

    // Sockets are torn down asynchronously, so a leftover from one test would
    // otherwise be counted by the next.
    const deadline = Date.now() + 5_000;

    while (socketServer.activeConnectionCount() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }, 30_000);

  afterAll(async () => {
    await socketServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await teardownPersistenceTestApp();
  }, 180_000);

  async function readData<TData>(response: Response): Promise<TData> {
    const body = (await response.json()) as { data: TData };
    return body.data;
  }

  /** Mints a ticket over REST and reads it back out of the Set-Cookie header. */
  async function mintTicket(accessToken?: string): Promise<string> {
    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments/socket-ticket`)}`,
      {
        method: "POST",
        headers: accessToken
          ? { authorization: `Bearer ${accessToken}` }
          : undefined,
      },
    );

    expect(response.status).toBe(201);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/ws/blog-comments");
    await expect(
      readData<Record<string, unknown>>(response),
    ).resolves.not.toHaveProperty("ticket");

    const ticket = /rentify_blog_ws_ticket=([^;]+)/.exec(setCookie)?.[1] ?? "";
    expect(ticket).toBeTruthy();
    return ticket;
  }

  async function connect(ticket: string): Promise<ConnectedSocket> {
    const socket = createClient(baseUrl, {
      path: BLOG_COMMENT_SOCKET_PATH,
      extraHeaders: { cookie: `rentify_blog_ws_ticket=${ticket}` },
      reconnection: false,
      // `socket.io-client` caches Managers by origin rather than by path, so a
      // shared Manager could otherwise route this at the booking gateway.
      forceNew: true,
    });
    sockets.push(socket);

    // Collector attached before the handshake resolves: `ready` and the
    // presence snapshot follow each other immediately.
    const collector = collectFrames(socket);

    await new Promise<void>((resolve, reject) => {
      socket.once("ready", () => resolve());
      socket.once("connect_error", reject);
    });

    return Object.assign(socket, collector);
  }

  it("refuses a handshake without a valid ticket", async () => {
    const socket = createClient(baseUrl, {
      path: BLOG_COMMENT_SOCKET_PATH,
      extraHeaders: { cookie: "rentify_blog_ws_ticket=not-a-real-ticket" },
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);

    const error = await new Promise<Error>((resolve) => {
      socket.once("connect_error", resolve);
    });

    expect(error.message).toBe("Unauthorized");
  });

  it("refuses to redeem a ticket twice", async () => {
    const ticket = await mintTicket();
    await connect(ticket);

    const second = createClient(baseUrl, {
      path: BLOG_COMMENT_SOCKET_PATH,
      extraHeaders: { cookie: `rentify_blog_ws_ticket=${ticket}` },
      reconnection: false,
      forceNew: true,
    });
    sockets.push(second);

    const error = await new Promise<Error>((resolve) => {
      second.once("connect_error", resolve);
    });

    expect(error.message).toBe("Unauthorized");
  });

  it("admits an anonymous reader read-only", async () => {
    const socket = await connect(await mintTicket());

    const ready = await socket.waitFor("ready");

    expect(ready.canWrite).toBe(false);
  });

  it("admits a signed-in reader with write access", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: RENTER_EMAIL,
    });

    const socket = await connect(await mintTicket(renter.accessToken));
    const ready = await socket.waitFor("ready");

    expect(ready.canWrite).toBe(true);
  });

  it("delivers a signed-in user's comment to an anonymous reader", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: RENTER_EMAIL,
    });
    const anonymous = await connect(await mintTicket());

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments`)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${renter.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ body: "Live delivery to a guest reader." }),
      },
    );
    expect(response.status).toBe(201);

    // The headline behaviour: a visitor with no session receives a comment
    // published by someone else, with no reload.
    const arrival = await anonymous.waitFor("comment.created");
    expect((arrival.comment as { body: string }).body).toBe(
      "Live delivery to a guest reader.",
    );
  });

  it("delivers an edit and a removal in place", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: RENTER_EMAIL,
    });
    const anonymous = await connect(await mintTicket());

    const createResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments`)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${renter.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ body: "First draft." }),
      },
    );
    const created = await readData<{ id: string }>(createResponse);

    await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments/${created.id}`)}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${renter.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ body: "Second draft." }),
      },
    );

    const updated = await anonymous.waitFor("comment.updated");
    expect((updated.comment as { body: string }).body).toBe("Second draft.");

    await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments/${created.id}`)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${renter.accessToken}` },
      },
    );

    const deleted = await anonymous.waitFor("comment.deleted");
    expect(deleted.comment).toMatchObject({ body: "", deletedBy: "author" });
  });

  it("labels a manager removal distinctly from an author withdrawal", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: RENTER_EMAIL,
    });
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });
    const anonymous = await connect(await mintTicket());

    const createResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments`)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${renter.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ body: "Something a manager removes." }),
      },
    );
    const created = await readData<{ id: string }>(createResponse);

    await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments/${created.id}`)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${owner.accessToken}` },
      },
    );

    const deleted = await anonymous.waitFor("comment.deleted");
    expect(deleted.comment).toMatchObject({ deletedBy: "moderator" });
  });

  it("counts anonymous and signed-in readers together", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: RENTER_EMAIL,
    });
    const first = await connect(await mintTicket());
    await connect(await mintTicket(renter.accessToken));

    const presence = await first.waitFor(
      "presence",
      (frame) => frame.readerCount === 2,
    );

    expect(presence.readerCount).toBe(2);
  });

  it("relays typing from a signed-in reader and names them", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: RENTER_EMAIL,
    });
    const anonymous = await connect(await mintTicket());
    const author = await connect(await mintTicket(renter.accessToken));

    author.emit("typing");

    const typing = await anonymous.waitFor("typing");
    expect(typing.username).toBe("renter-one");
  });

  it("ignores typing from an anonymous reader", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: RENTER_EMAIL,
    });
    const watcher = await connect(await mintTicket(renter.accessToken));
    const anonymous = await connect(await mintTicket());

    anonymous.emit("typing");
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(watcher.frames.some((frame) => frame.type === "typing")).toBe(false);
  });

  it("tells open readers when a manager closes comments", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });
    const anonymous = await connect(await mintTicket());

    const post =
      await persistenceApp.prisma.organizationBlogPost.findFirstOrThrow({
        where: { organizationId: ORGANIZATION_ID, slug: OPEN_SLUG },
      });

    await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog-posts/${post.id}`,
      )}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${owner.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ commentsEnabled: false }),
      },
    );

    const closed = await anonymous.waitFor("comments.closed");
    expect(closed.commentsEnabled).toBe(false);
  });

  it("releases the room when the last reader leaves", async () => {
    const socket = await connect(await mintTicket());

    socket.disconnect();

    const deadline = Date.now() + 5_000;
    while (socketServer.activeConnectionCount() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const post =
      await persistenceApp.prisma.organizationBlogPost.findFirstOrThrow({
        where: { organizationId: ORGANIZATION_ID, slug: OPEN_SLUG },
      });

    await expect(socketServer.countReaders(asUuid(post.id))).resolves.toBe(0);
  });
});
