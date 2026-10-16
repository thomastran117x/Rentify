import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  io as createClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import { containerTokens } from "@/configuration/container/tokens";
import { buildApiPath } from "@/configuration/http/api-path";
import { asUuid } from "@/configuration/validation/uuid";
import type {
  CreatedMediaUpload,
  MediaStatusEvent,
} from "@/features/media/media.model";
import {
  MEDIA_STATUS_SOCKET_PATH,
  type MediaStatusSocketServer,
} from "@/features/media/media-status-socket.server";
import { createPngFixture } from "../../support/image-fixtures";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const OWNER_EMAIL = "owner1@rentify.local";
const OTHER_EMAIL = "viewer1@rentify.local";
const COOKIE_NAME = "rentify_media_ws_ticket";

/** A connected client and every status it has been pushed. */
type ConnectedSocket = ClientSocket & { statuses: MediaStatusEvent[] };

/**
 * Drives the media status gateway over a real socket, with the worker's side
 * played by the container's Redis-emitter publisher, so a push crosses Redis
 * exactly as it does from the processing worker to the API.
 */
describe("Media status socket integration", () => {
  let persistenceApp: PersistenceTestApp;
  let socketServer: MediaStatusSocketServer;
  let httpServer: Server;
  let baseUrl: string;
  const sockets: ClientSocket[] = [];

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
    httpServer = createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    socketServer = persistenceApp.container.resolve(
      containerTokens.mediaStatusSocketServer,
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

  function request(path: string, init: RequestInit = {}): Promise<Response> {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  async function mintTicket(headers: HeadersInit): Promise<string> {
    const response = await request("/media/socket-ticket", {
      method: "POST",
      headers,
    });

    expect(response.status).toBe(201);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/ws/media");
    const body = (await response.json()) as { data: Record<string, unknown> };
    // The ticket travels only in the cookie.
    expect(body.data).toEqual({ expiresInSeconds: 30 });

    const ticket =
      new RegExp(`${COOKIE_NAME}=([^;]+)`).exec(setCookie)?.[1] ?? "";
    expect(ticket).toBeTruthy();
    return ticket;
  }

  function open(ticket: string): ClientSocket {
    const socket = createClient(baseUrl, {
      path: MEDIA_STATUS_SOCKET_PATH,
      extraHeaders: { cookie: `${COOKIE_NAME}=${ticket}` },
      reconnection: false,
    });
    sockets.push(socket);
    return socket;
  }

  async function connect(ticket: string): Promise<ConnectedSocket> {
    const socket = Object.assign(open(ticket), {
      statuses: [] as MediaStatusEvent[],
    });
    socket.on("media.status", (event: MediaStatusEvent) => {
      socket.statuses.push(event);
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("ready", () => resolve());
      socket.once("connect_error", reject);
    });

    return socket;
  }

  function connectExpectingFailure(ticket: string): Promise<Error> {
    const socket = open(ticket);

    return new Promise<Error>((resolve) => {
      socket.once("connect_error", resolve);
    });
  }

  async function waitForStatus(
    socket: ConnectedSocket,
    mediaId: string,
  ): Promise<MediaStatusEvent> {
    const deadline = Date.now() + 10_000;

    while (Date.now() < deadline) {
      const found = socket.statuses.find((event) => event.mediaId === mediaId);

      if (found) {
        return found;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(`No status was pushed for ${mediaId}.`);
  }

  it("refuses a handshake without a valid ticket", async () => {
    await expect(
      connectExpectingFailure("not-a-ticket"),
    ).resolves.toMatchObject({ message: "Unauthorized" });
  }, 30_000);

  it("admits a ticket only once", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });
    const ticket = await mintTicket(owner.headers());

    await connect(ticket);

    await expect(connectExpectingFailure(ticket)).resolves.toMatchObject({
      message: "Unauthorized",
    });
  }, 30_000);

  it("pushes a status only to the sockets of the user it belongs to", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });
    const other = await createAuthenticatedRequestContext({
      email: OTHER_EMAIL,
    });
    const ownerSocket = await connect(await mintTicket(owner.headers()));
    const secondOwnerSocket = await connect(await mintTicket(owner.headers()));
    const otherSocket = await connect(await mintTicket(other.headers()));
    const event: MediaStatusEvent = {
      mediaId: asUuid("00000000-0000-0000-9000-000000994400"),
      status: "rejected",
    };

    persistenceApp.container
      .resolve(containerTokens.mediaStatusPublisher)
      .publish(asUuid(owner.userId), event);

    await expect(waitForStatus(ownerSocket, event.mediaId)).resolves.toEqual(
      event,
    );
    await expect(
      waitForStatus(secondOwnerSocket, event.mediaId),
    ).resolves.toEqual(event);
    // Given time to arrive, had it been sent.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(otherSocket.statuses).toEqual([]);
  }, 30_000);

  it("tells the owner the moment processing makes an upload ready", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });
    const socket = await connect(await mintTicket(owner.headers()));
    const created = await request("/media/uploads", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify({
        filename: "photo.png",
        contentType: "image/png",
        scope: "postings",
      }),
    });
    const { mediaId, upload } = (
      (await created.json()) as { data: CreatedMediaUpload }
    ).data;
    await request(`/blob/upload?${new URL(upload.url).searchParams}`, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(await createPngFixture(64, 48)),
    });
    await request(`/media/${mediaId}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });

    // What the worker does with the queued job.
    await persistenceApp.container
      .resolve(containerTokens.mediaProcessingService)
      .process(mediaId);

    await expect(waitForStatus(socket, mediaId)).resolves.toEqual({
      mediaId,
      status: "ready",
    });
  }, 60_000);
});
