import { containerTokens } from "@/configuration/container/tokens";
import { buildApiPath } from "@/configuration/http/api-path";
import type { EmailJobPayload } from "@/features/email/email.model";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import {
  waitForRabbitMqPayload,
  waitForRabbitMqPayloads,
} from "../../support/live-rabbitmq-assertions";

const EMAIL_QUEUE_NAME = "email.delivery.main";
// Posting 3 belongs to owner1's organization.
const MUTABLE_POSTING_ID = "00000000-0000-0000-2000-000000000003";

// viewer1 has no organization membership anywhere, so it is an unambiguous
// renter. Seeded booking #1 is deliberately avoided: its renter (user1) is also
// a manager in owner1's organization, which would blur the authorization cases.
const RENTER_EMAIL = "viewer1@rentify.local";
const OWNER_EMAIL = "owner1@rentify.local";
const OPERATOR_EMAIL = "user2@rentify.local";
const OUTSIDER_EMAIL = "user3@rentify.local";

describe("Booking messages persistence integration", () => {
  let persistenceApp: PersistenceTestApp;

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterAll(async () => {
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

    const createResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${MUTABLE_POSTING_ID}/booking-requests`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          startAt: "2027-03-10T16:00:00.000Z",
          endAt: "2027-03-12T16:00:00.000Z",
          guestCount: 1,
          note: "Quiet work trip.",
          contactName: "Viewer One",
          contactEmail: RENTER_EMAIL,
        }),
      },
    );

    expect(createResponse.status).toBe(201);

    const booking = await persistenceApp.prisma.bookingRequest.findFirstOrThrow(
      {
        where: { postingId: MUTABLE_POSTING_ID, renterId: renter.userId },
        orderBy: { createdAt: "desc" },
      },
    );

    return { renter, bookingRequestId: booking.id };
  }

  it("round-trips messages between the renter and the owner", async () => {
    const { renter, bookingRequestId } = await createThread();
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });

    const sendResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({ body: "Is an early pickup possible?" }),
      },
    );

    expect(sendResponse.status).toBe(201);
    expect(await readData(sendResponse)).toMatchObject({
      bookingRequestId,
      authorId: renter.userId,
      authorSide: "renter",
      body: "Is an early pickup possible?",
      readAt: null,
    });

    const ownerListResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      { headers: owner.headers() },
    );

    expect(ownerListResponse.status).toBe(200);
    const ownerList = await readData<{
      messages: Array<Record<string, unknown>>;
      unreadCount: number;
      canWrite: boolean;
      viewerSide: string;
    }>(ownerListResponse);
    expect(ownerList.messages).toHaveLength(1);
    expect(ownerList.messages[0]).toMatchObject({ authorSide: "renter" });
    expect(ownerList.unreadCount).toBe(1);
    expect(ownerList.canWrite).toBe(true);
    expect(ownerList.viewerSide).toBe("owner");

    const replyResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({ body: "Yes, from 9am." }),
      },
    );

    expect(replyResponse.status).toBe(201);
    expect(await readData(replyResponse)).toMatchObject({
      authorSide: "owner",
    });

    const renterListResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      { headers: renter.headers() },
    );

    const renterList = await readData<{
      messages: Array<{ body: string }>;
    }>(renterListResponse);
    expect(renterList.messages.map((message) => message.body)).toEqual([
      "Yes, from 9am.",
      "Is an early pickup possible?",
    ]);
  }, 60_000);

  it("lets the author edit and soft delete their own message", async () => {
    const { renter, bookingRequestId } = await createThread();
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });

    const sendResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({ body: "Original text" }),
      },
    );
    const created = await readData<{ id: string; authorUsername: string }>(
      sendResponse,
    );
    expect(created.authorUsername).toBe("viewer-one");

    const editResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages/${created.id}`)}`,
      {
        method: "PATCH",
        headers: renter.headers(),
        body: JSON.stringify({ body: "Corrected text" }),
      },
    );

    expect(editResponse.status).toBe(200);
    const edited = await readData<{ body: string; editedAt: string | null }>(
      editResponse,
    );
    expect(edited.body).toBe("Corrected text");
    expect(edited.editedAt).not.toBeNull();

    // Only the author may change it, even for a manager on the other side.
    const ownerEditResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages/${created.id}`)}`,
      {
        method: "PATCH",
        headers: owner.headers(),
        body: JSON.stringify({ body: "Not mine to change" }),
      },
    );
    expect(ownerEditResponse.status).toBe(403);

    const deleteResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages/${created.id}`)}`,
      { method: "DELETE", headers: renter.headers() },
    );

    expect(deleteResponse.status).toBe(200);
    const deleted = await readData<{ body: string; deletedAt: string | null }>(
      deleteResponse,
    );
    expect(deleted.body).toBe("");
    expect(deleted.deletedAt).not.toBeNull();

    // The row survives as a tombstone so the booking keeps the record.
    const listResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      { headers: renter.headers() },
    );
    const list = await readData<{
      messages: Array<{ id: string; deletedAt: string | null }>;
      counterpartName: string;
    }>(listResponse);
    expect(list.messages.map((message) => message.id)).toContain(created.id);
    expect(list.counterpartName).toBeTruthy();

    // A second delete is rejected rather than silently repeated.
    const repeatDeleteResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages/${created.id}`)}`,
      { method: "DELETE", headers: renter.headers() },
    );
    expect(repeatDeleteResponse.status).toBe(400);
  }, 60_000);

  it("returns 403 on every endpoint for a user who is not a party", async () => {
    const { bookingRequestId } = await createThread();
    const outsider = await createAuthenticatedRequestContext({
      email: OUTSIDER_EMAIL,
    });

    const listResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      { headers: outsider.headers() },
    );
    expect(listResponse.status).toBe(403);

    const sendResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      {
        method: "POST",
        headers: outsider.headers(),
        body: JSON.stringify({ body: "Let me in." }),
      },
    );
    expect(sendResponse.status).toBe(403);

    const readResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages/read`)}`,
      { method: "POST", headers: outsider.headers() },
    );
    expect(readResponse.status).toBe(403);

    const streamResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages/stream`)}`,
      { headers: outsider.headers() },
    );
    expect(streamResponse.status).toBe(403);
  }, 60_000);

  it("lets an organization operator read but not write", async () => {
    const { renter, bookingRequestId } = await createThread();
    const operator = await createAuthenticatedRequestContext({
      email: OPERATOR_EMAIL,
    });

    await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({ body: "Question for the team." }),
      },
    );

    const listResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      { headers: operator.headers() },
    );
    expect(listResponse.status).toBe(200);
    // The capability the client renders from must match what the API enforces.
    expect(
      await readData<{ canWrite: boolean; viewerSide: string }>(listResponse),
    ).toMatchObject({ canWrite: false, viewerSide: "owner" });

    const sendResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      {
        method: "POST",
        headers: operator.headers(),
        body: JSON.stringify({ body: "Answering on behalf." }),
      },
    );
    expect(sendResponse.status).toBe(403);

    const readResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages/read`)}`,
      { method: "POST", headers: operator.headers() },
    );
    expect(readResponse.status).toBe(403);
  }, 60_000);

  it("validates the message body", async () => {
    const { renter, bookingRequestId } = await createThread();

    for (const payload of [
      {},
      { body: "" },
      { body: "   " },
      { body: "x".repeat(2001) },
    ]) {
      const response = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
        {
          method: "POST",
          headers: renter.headers(),
          body: JSON.stringify(payload),
        },
      );

      expect(response.status).toBe(400);
    }

    const maxLengthResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({ body: "x".repeat(2000) }),
      },
    );

    expect(maxLengthResponse.status).toBe(201);
  }, 60_000);

  it("returns 404 for an unknown booking request", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: RENTER_EMAIL,
    });

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/booking-requests/00000000-0000-0000-9999-000000000001/messages")}`,
      { headers: renter.headers() },
    );

    expect(response.status).toBe(404);
  }, 60_000);

  it("tracks read state per side", async () => {
    const { renter, bookingRequestId } = await createThread();
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });

    for (const body of ["Owner note one.", "Owner note two."]) {
      await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
        {
          method: "POST",
          headers: owner.headers(),
          body: JSON.stringify({ body }),
        },
      );
    }

    await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({ body: "Renter reply." }),
      },
    );

    const renterReadResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages/read`)}`,
      { method: "POST", headers: renter.headers() },
    );

    expect(renterReadResponse.status).toBe(200);
    expect(await readData(renterReadResponse)).toMatchObject({
      bookingRequestId,
      markedCount: 2,
    });

    const renterListResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      { headers: renter.headers() },
    );
    const renterList = await readData<{
      messages: Array<{ authorSide: string; readAt: string | null }>;
      unreadCount: number;
    }>(renterListResponse);

    expect(renterList.unreadCount).toBe(0);
    for (const message of renterList.messages) {
      // Owner-authored messages are now read; the renter's own is not.
      expect(Boolean(message.readAt)).toBe(message.authorSide === "owner");
    }

    const ownerListResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      { headers: owner.headers() },
    );
    expect(
      (await readData<{ unreadCount: number }>(ownerListResponse)).unreadCount,
    ).toBe(1);

    const ownerReadResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages/read`)}`,
      { method: "POST", headers: owner.headers() },
    );
    expect(await readData(ownerReadResponse)).toMatchObject({
      markedCount: 1,
    });
  }, 60_000);

  it("paginates the thread without duplicating rows", async () => {
    const { renter, bookingRequestId } = await createThread();

    for (const body of ["First.", "Second.", "Third."]) {
      await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
        {
          method: "POST",
          headers: renter.headers(),
          body: JSON.stringify({ body }),
        },
      );
    }

    const firstPageResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages?page=1&pageSize=2`)}`,
      { headers: renter.headers() },
    );
    const firstPage = await readData<{
      messages: Array<{ id: string }>;
      pagination: Record<string, unknown>;
    }>(firstPageResponse);

    expect(firstPage.messages).toHaveLength(2);
    expect(firstPage.pagination).toMatchObject({
      page: 1,
      total: 3,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    });

    const secondPageResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages?page=2&pageSize=2`)}`,
      { headers: renter.headers() },
    );
    const secondPage = await readData<{
      messages: Array<{ id: string }>;
      pagination: Record<string, unknown>;
    }>(secondPageResponse);

    expect(secondPage.messages).toHaveLength(1);
    expect(secondPage.pagination).toMatchObject({
      page: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    });

    const ids = [...firstPage.messages, ...secondPage.messages].map(
      (message) => message.id,
    );
    expect(new Set(ids).size).toBe(3);
  }, 60_000);

  it("queues one notification email and throttles the follow-up", async () => {
    const { renter, bookingRequestId } = await createThread();
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });

    await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({ body: "First question." }),
      },
    );

    // Assert the enqueued job, never an inbox: seeded @rentify.local recipients
    // are always suppressed outside production, and the email worker container
    // does not run in this process.
    const job = await waitForRabbitMqPayload<EmailJobPayload>(
      persistenceApp.infra.rabbitMq,
      EMAIL_QUEUE_NAME,
      (payload) =>
        payload.kind === "booking_message" &&
        payload.input.bookingRequestId === bookingRequestId,
    );

    expect(job).toMatchObject({
      kind: "booking_message",
      input: {
        bookingRequestId,
        recipientId: owner.userId,
      },
    });

    await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({ body: "Second question." }),
      },
    );

    // The management `get` API requeues, so the first job is still readable.
    // Assert that a *second* distinct job never appears.
    await expect(
      waitForRabbitMqPayloads<EmailJobPayload>(
        persistenceApp.infra.rabbitMq,
        EMAIL_QUEUE_NAME,
        (payload) =>
          payload.kind === "booking_message" &&
          payload.input.bookingRequestId === bookingRequestId,
        { minMatches: 2, timeoutMs: 3_000 },
      ),
    ).rejects.toThrow();
  }, 60_000);

  it("streams a message created after the stream opened", async () => {
    const { renter, bookingRequestId } = await createThread();
    const owner = await createAuthenticatedRequestContext({
      email: OWNER_EMAIL,
    });

    const streamResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages/stream`)}`,
      { headers: owner.headers() },
    );

    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain(
      "text/event-stream",
    );

    const reader = streamResponse.body!.getReader();
    const decoder = new TextDecoder();

    // Always race the read loop: a stream that never yields would otherwise
    // hang until Jest's global timeout.
    async function readUntil(marker: string): Promise<string> {
      let buffer = "";

      const readLoop = (async () => {
        while (!buffer.includes(marker)) {
          const chunk = await reader.read();

          if (chunk.done) {
            throw new Error(`Stream closed before receiving "${marker}".`);
          }

          buffer += decoder.decode(chunk.value, { stream: true });
        }

        return buffer;
      })();

      let timer: NodeJS.Timeout | undefined;

      try {
        return await Promise.race([
          readLoop,
          new Promise<string>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Timed out waiting for "${marker}".`)),
              10_000,
            );
          }),
        ]);
      } finally {
        // Clearing matters: an un-cleared timer keeps the event loop alive
        // after the test finishes and makes Jest hang on exit.
        clearTimeout(timer);
      }
    }

    try {
      await readUntil("event: ready");

      await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/booking-requests/${bookingRequestId}/messages`)}`,
        {
          method: "POST",
          headers: renter.headers(),
          body: JSON.stringify({ body: "Streamed hello." }),
        },
      );

      const received = await readUntil("event: message.created");
      expect(received).toContain("Streamed hello.");
    } finally {
      await reader.cancel();
    }

    // Disconnecting must unwind the Redis subscription. A leak here is
    // otherwise invisible: StreamingApi.write swallows every error, so a
    // stranded stream would keep a heartbeat timer and a subscription alive
    // with nothing surfacing in logs.
    const hub = persistenceApp.container.resolve(
      containerTokens.bookingMessageStreamHub,
    );

    const deadline = Date.now() + 5_000;
    while (hub.activeChannelCount() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(hub.activeChannelCount()).toBe(0);
  }, 60_000);
});
