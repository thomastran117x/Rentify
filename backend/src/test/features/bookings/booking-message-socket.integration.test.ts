import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import WebSocket from "ws";
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

const MUTABLE_POSTING_ID = "00000000-0000-0000-2000-000000000003";
const RENTER_EMAIL = "viewer1@rentify.local";
const OWNER_EMAIL = "owner1@rentify.local";

interface SocketEvent {
  type: string;
  [key: string]: unknown;
}

/** Collects frames so a test can await one without racing the socket. */
function collectFrames(socket: WebSocket) {
  const frames: SocketEvent[] = [];

  socket.on("message", (raw) => {
    try {
      frames.push(JSON.parse(raw.toString()) as SocketEvent);
    } catch {
      // Ignored: the assertions below only care about well-formed frames.
    }
  });

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
        `Timed out waiting for a "${type}" frame. Saw: ${frames
          .map((frame) => frame.type)
          .join(", ")}`,
      );
    },
  };
}

describe("Booking message socket integration", () => {
  let persistenceApp: PersistenceTestApp;
  let socketServer: BookingMessageSocketServer;
  let httpServer: Server;
  let baseUrl: string;
  let threadSequence = 0;

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();

    // A bare HTTP server is enough: only the upgrade path is exercised here,
    // and REST calls still go through app.request in-process.
    httpServer = createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });

    socketServer = new BookingMessageSocketServer();
    socketServer.attach(httpServer);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}${BOOKING_MESSAGE_SOCKET_PATH}`;
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterEach(async () => {
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

  async function connect(ticket: string): Promise<WebSocket> {
    const socket = new WebSocket(baseUrl, {
      headers: { cookie: `rentify_ws_ticket=${ticket}` },
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    return socket;
  }

  it("rejects an upgrade without a valid ticket", async () => {
    const socket = new WebSocket(baseUrl, {
      headers: { cookie: "rentify_ws_ticket=not-a-real-ticket" },
    });

    const error = await new Promise<Error>((resolve) => {
      socket.once("error", resolve);
    });

    expect(error.message).toMatch(/401/);
    socket.terminate();
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

  it("delivers a message published while the socket is open", async () => {
    const { renter, bookingRequestId } = await createThread();
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });

    const socket = await connect(
      await mintTicket(bookingRequestId, owner.headers()),
    );
    const collector = collectFrames(socket);

    try {
      await collector.waitFor("ready");

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
      socket.close();
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
    const ownerFrames = collectFrames(ownerSocket);
    const renterSocket = await connect(
      await mintTicket(bookingRequestId, renter.headers()),
    );

    try {
      await ownerFrames.waitFor("ready");

      renterSocket.send(JSON.stringify({ type: "typing" }));

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
      ownerSocket.close();
      renterSocket.close();
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
    const ownerFrames = collectFrames(ownerSocket);

    try {
      await ownerFrames.waitFor("ready");

      const renterSocket = await connect(
        await mintTicket(bookingRequestId, renter.headers()),
      );

      const presence = await ownerFrames.waitFor(
        "presence",
        (frame) => frame.side === "renter",
      );
      expect(presence).toMatchObject({
        bookingRequestId,
        side: "renter",
        state: "online",
      });

      renterSocket.close();
    } finally {
      ownerSocket.close();
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
    const ownerFrames = collectFrames(ownerSocket);

    try {
      await ownerFrames.waitFor("ready");

      ownerSocket.send(
        JSON.stringify({ type: "delivered", messageIds: [created.id] }),
      );

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
      ownerSocket.close();
    }
  }, 60_000);

  it("releases its hub subscription when a socket closes", async () => {
    const { bookingRequestId } = await createThread();
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });

    const socket = await connect(
      await mintTicket(bookingRequestId, owner.headers()),
    );
    await collectFrames(socket).waitFor("ready");

    expect(socketServer.activeConnectionCount()).toBe(1);

    socket.close();

    const hub = persistenceApp.container.resolve(
      containerTokens.bookingMessageStreamHub,
    );
    const deadline = Date.now() + 5_000;

    while (
      (socketServer.activeConnectionCount() > 0 ||
        hub.activeChannelCount() > 0) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(socketServer.activeConnectionCount()).toBe(0);
    expect(hub.activeChannelCount()).toBe(0);
  }, 60_000);
});
