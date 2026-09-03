import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import {
  io as createClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import { containerTokens } from "@/configuration/container/tokens";
import { buildApiPath } from "@/configuration/http/api-path";
import {
  BOOKING_MESSAGE_SOCKET_PATH,
  BookingMessageSocketServer,
} from "@/features/bookings/messages/booking-message-socket.server";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { testUuid } from "../../support/uuid";

const OWNER_ID = testUuid(9000, 166717);

const MUTABLE_POSTING_ID = "00000000-0000-0000-2000-000000000003";
const RENTER_EMAIL = "viewer1@rentify.local";
const OWNER_EMAIL = "owner1@rentify.local";

interface SocketEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Collects events so a test can await one without racing the socket. Socket.IO
 * delivers named events rather than a single message stream, so every event the
 * gateway can emit is subscribed up front.
 */
const COLLECTED_EVENTS = [
  "ready",
  "message.created",
  "message.updated",
  "messages.read",
  "messages.delivered",
  "typing",
  "presence",
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

/** A connected client with its event collector attached. */
type ConnectedSocket = ClientSocket & ReturnType<typeof collectFrames>;

describe("Booking message socket integration", () => {
  let persistenceApp: PersistenceTestApp;
  let socketServer: BookingMessageSocketServer;
  let httpServer: Server;
  let baseUrl: string;
  let threadSequence = 0;
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
      containerTokens.bookingMessageSocketServer,
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

  async function createThread() {
    const renter = await createAuthenticatedRequestContext({
      email: RENTER_EMAIL,
    });

    threadSequence += 1;
    const startDay = String(threadSequence * 2).padStart(2, "0");
    const endDay = String(threadSequence * 2 + 1).padStart(2, "0");

    await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${MUTABLE_POSTING_ID}/booking-requests`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          startAt: `2027-04-${startDay}T16:00:00.000Z`,
          endAt: `2027-04-${endDay}T16:00:00.000Z`,
          guestCount: 1,
          contactName: "Viewer One",
          contactEmail: RENTER_EMAIL,
        }),
      },
    );

    const booking = await persistenceApp.prisma.bookingRequest.findFirstOrThrow(
      {
        where: {
          postingId: MUTABLE_POSTING_ID,
          renterId: renter.userId,
          startAt: new Date(`2027-04-${startDay}T16:00:00.000Z`),
        },
      },
    );

    return { renter, bookingRequestId: booking.id };
  }

  async function mintTicket(
    bookingRequestId: string,
    headers: HeadersInit,
  ): Promise<string> {
    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages/socket-ticket`)}`,
      { method: "POST", headers },
    );

    expect(response.status).toBe(201);

    // The ticket is delivered as an HttpOnly cookie, never in the body.
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/ws/booking-messages");
    await expect(
      readData<Record<string, unknown>>(response),
    ).resolves.not.toHaveProperty("ticket");

    const ticket = /rentify_ws_ticket=([^;]+)/.exec(setCookie)?.[1] ?? "";
    expect(ticket).toBeTruthy();
    return ticket;
  }

  async function connect(ticket: string): Promise<ConnectedSocket> {
    const socket = createClient(baseUrl, {
      path: BOOKING_MESSAGE_SOCKET_PATH,
      extraHeaders: { cookie: `rentify_ws_ticket=${ticket}` },
      reconnection: false,
    });
    sockets.push(socket);

    // Collector attached before the handshake resolves: `ready` and the
    // presence snapshot follow each other immediately, and a collector built
    // afterwards races them.
    const collector = collectFrames(socket);

    await new Promise<void>((resolve, reject) => {
      socket.once("ready", () => resolve());
      socket.once("connect_error", reject);
    });

    return Object.assign(socket, collector);
  }

  function connectExpectingFailure(ticket: string): Promise<Error> {
    const socket = createClient(baseUrl, {
      path: BOOKING_MESSAGE_SOCKET_PATH,
      extraHeaders: { cookie: `rentify_ws_ticket=${ticket}` },
      reconnection: false,
    });
    sockets.push(socket);

    return new Promise<Error>((resolve) => {
      socket.once("connect_error", resolve);
    });
  }

  it("refuses a handshake without a valid ticket", async () => {
    const error = await connectExpectingFailure("not-a-real-ticket");

    expect(error.message).toBe("Unauthorized");
  }, 30_000);

  it("refuses a ticket whose session has been revoked", async () => {
    const { renter, bookingRequestId } = await createThread();
    const ticket = await mintTicket(bookingRequestId, renter.headers());

    const scope = persistenceApp.container.createScope();
    const service = scope.resolve(containerTokens.bookingMessagesService);
    const identity = await service.redeemSocketTicket(ticket);

    if (!identity) {
      throw new Error("Expected the ticket to redeem.");
    }

    // Healthy first: this is the same check the reauthorization sweep runs, and
    // it has to pass before its failure means anything.
    await expect(
      service.assertSocketSessionValid(identity),
    ).resolves.toBeUndefined();

    // Bumping the token version is what a logout or password change does. The
    // membership is untouched, so a socket checking only membership would sail
    // straight past this and keep streaming to a signed-out user.
    await persistenceApp.prisma.user.update({
      where: { id: renter.userId },
      data: { tokenVersion: { increment: 1 } },
    });

    await expect(service.assertSocketSessionValid(identity)).rejects.toThrow(
      /no longer valid/i,
    );

    await scope.dispose();
  }, 60_000);

  it("refuses to redeem a ticket minted before the session was revoked", async () => {
    const { renter, bookingRequestId } = await createThread();
    const ticket = await mintTicket(bookingRequestId, renter.headers());

    // The sweep only closes sockets that already exist. A ticket minted just
    // before a logout has thirty seconds of life left, and without a session
    // check at redemption it still buys a brand new connection.
    await persistenceApp.prisma.user.update({
      where: { id: renter.userId },
      data: { tokenVersion: { increment: 1 } },
    });

    const scope = persistenceApp.container.createScope();
    const service = scope.resolve(containerTokens.bookingMessagesService);

    await expect(service.redeemSocketTicket(ticket)).resolves.toBeNull();

    await scope.dispose();
  }, 60_000);

  it("rejects the upgrade itself once the session is revoked", async () => {
    const { renter, bookingRequestId } = await createThread();
    const ticket = await mintTicket(bookingRequestId, renter.headers());

    await persistenceApp.prisma.user.update({
      where: { id: renter.userId },
      data: { tokenVersion: { increment: 1 } },
    });

    // End to end over a real handshake, not just the service call: the socket
    // must never open in the first place.
    const error = await connectExpectingFailure(ticket);

    expect(error.message).toBe("Unauthorized");
  }, 60_000);

  it("delivers a message published while the socket is open", async () => {
    const { renter, bookingRequestId } = await createThread();
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });

    const socket = await connect(
      await mintTicket(bookingRequestId, owner.headers()),
    );
    const collector = socket;

    try {
      await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
        {
          method: "POST",
          headers: renter.headers(),
          body: JSON.stringify({ body: "Socket delivery" }),
        },
      );

      const created = await collector.waitFor("message.created");
      expect(created).toMatchObject({
        bookingRequestId,
        message: expect.objectContaining({ body: "Socket delivery" }),
      });
    } finally {
      socket.disconnect();
    }
  }, 60_000);

  it("broadcasts typing from one side to the other", async () => {
    const { renter, bookingRequestId } = await createThread();
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });

    const ownerSocket = await connect(
      await mintTicket(bookingRequestId, owner.headers()),
    );
    const ownerFrames = ownerSocket;
    const renterSocket = await connect(
      await mintTicket(bookingRequestId, renter.headers()),
    );

    try {
      renterSocket.emit("typing");

      const typing = await ownerFrames.waitFor("typing");
      expect(typing).toMatchObject({
        bookingRequestId,
        side: "renter",
        username: "viewer-one",
      });
      // Ephemeral: it carries its own expiry rather than needing a stop frame.
      expect(new Date(typing.expiresAt as string).getTime()).toBeGreaterThan(
        Date.now(),
      );
    } finally {
      ownerSocket.disconnect();
      renterSocket.disconnect();
    }
  }, 60_000);

  it("announces presence when a party joins the thread", async () => {
    const { renter, bookingRequestId } = await createThread();
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });

    const ownerSocket = await connect(
      await mintTicket(bookingRequestId, owner.headers()),
    );
    const ownerFrames = ownerSocket;

    try {
      // The snapshot the owner receives on connect: nobody is on the renter
      // side yet. Matched on state as well as side, because there are now two
      // presence frames in play and the first one says the opposite.
      const snapshot = await ownerFrames.waitFor(
        "presence",
        (frame) => frame.side === "renter",
      );
      expect(snapshot).toMatchObject({ side: "renter", state: "offline" });

      const renterSocket = await connect(
        await mintTicket(bookingRequestId, renter.headers()),
      );

      const presence = await ownerFrames.waitFor(
        "presence",
        (frame) => frame.side === "renter" && frame.state === "online",
      );
      expect(presence).toMatchObject({
        bookingRequestId,
        side: "renter",
        state: "online",
      });

      renterSocket.disconnect();
    } finally {
      ownerSocket.disconnect();
    }
  }, 60_000);

  it("tells a late joiner that the other party is already here", async () => {
    const { renter, bookingRequestId } = await createThread();
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });

    // The renter arrives first and their "online" is announced to nobody.
    const renterSocket = await connect(
      await mintTicket(bookingRequestId, renter.headers()),
    );

    const ownerSocket = await connect(
      await mintTicket(bookingRequestId, owner.headers()),
    );
    const ownerFrames = ownerSocket;

    try {
      // Without a snapshot on connect the owner would show the renter as
      // offline indefinitely: the arrival they missed is never replayed, and a
      // live key is deliberately not re-announced on refresh.
      const presence = await ownerFrames.waitFor(
        "presence",
        (frame) => frame.side === "renter",
      );
      expect(presence).toMatchObject({ side: "renter", state: "online" });
    } finally {
      renterSocket.disconnect();
      ownerSocket.disconnect();
    }
  }, 60_000);

  it("persists a delivery acknowledgement sent over the socket", async () => {
    const { renter, bookingRequestId } = await createThread();
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });

    const sendResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({ body: "Ack me" }),
      },
    );
    const created = await readData<{ id: string }>(sendResponse);

    const ownerSocket = await connect(
      await mintTicket(bookingRequestId, owner.headers()),
    );
    const ownerFrames = ownerSocket;

    try {
      ownerSocket.emit("delivered", [created.id]);

      const delivered = await ownerFrames.waitFor("messages.delivered");
      expect(delivered).toMatchObject({ messageIds: [created.id] });

      const stored =
        await persistenceApp.prisma.bookingMessage.findUniqueOrThrow({
          where: { id: created.id },
        });
      expect(stored.deliveredAt).not.toBeNull();
      // Delivery is weaker than read: acknowledging receipt must not mark it read.
      expect(stored.readAt).toBeNull();
    } finally {
      ownerSocket.disconnect();
    }
  }, 60_000);

  it("leaves its rooms when a socket closes", async () => {
    const { bookingRequestId } = await createThread();
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });

    const socket = await connect(
      await mintTicket(bookingRequestId, owner.headers()),
    );

    expect(socketServer.activeConnectionCount()).toBe(1);
    await expect(
      socketServer.isSideOnline(bookingRequestId, OWNER_ID),
    ).resolves.toBe(true);

    socket.disconnect();

    const deadline = Date.now() + 5_000;

    while (socketServer.activeConnectionCount() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(socketServer.activeConnectionCount()).toBe(0);
    // Room membership is the successor to the old hub subscription: nothing is
    // left behind for the adapter to answer with, so presence reads as offline
    // without any separate bookkeeping to clean up.
    await expect(
      socketServer.isSideOnline(bookingRequestId, OWNER_ID),
    ).resolves.toBe(false);
  }, 60_000);
});
