import { containerTokens } from "@/configuration/bootstrap/container";
import { buildApiPath } from "@/configuration/http/api-path";
import type { PostingExpiryService } from "@/features/postings/posting-expiry.service";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { peekRabbitMqMessages } from "../../support/live-rabbitmq";

const EMAIL_QUEUE_NAME = "email.delivery.main";
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function buildPostingPhoto(blobName: string) {
  return {
    blobUrl: `http://blob.test/uploads/${blobName}?blobName=${blobName}`,
    blobName,
    position: 0,
  };
}

function buildCreatePostingBody(overrides: Record<string, unknown> = {}) {
  return {
    variant: {
      family: "place",
      subtype: "workspace",
    },
    name: "Expiry Test Workspace",
    description: "Bright loft used to exercise the posting expiry sweep.",
    pricing: {
      currency: "cad",
      daily: {
        amount: 155,
      },
    },
    photos: [buildPostingPhoto("postings/expiry-workspace.jpg")],
    tags: ["Loft", "Test"],
    details: {
      guest_capacity: 4,
      property_type: "loft",
      amenities: ["wifi"],
    },
    availabilityStatus: "available",
    availabilityBlocks: [],
    location: {
      latitude: 43.6532,
      longitude: -79.3832,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
      postalCode: "M5H 2N2",
    },
    ...overrides,
  };
}

describe("posting expiry persistence", () => {
  let persistenceApp: PersistenceTestApp;

  async function request(
    path: string,
    init: RequestInit & { headers?: Record<string, string> } = {},
  ): Promise<Response> {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  function resolveExpiryService(): PostingExpiryService {
    const scope = persistenceApp.container.createScope();
    return scope.resolve(containerTokens.postingExpiryService);
  }

  async function createPublishedPosting(
    owner: Awaited<ReturnType<typeof createAuthenticatedRequestContext>>,
    expiresAt: string | null,
  ): Promise<string> {
    const createResponse = await request("/postings", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify(buildCreatePostingBody({ expiresAt })),
    });

    expect(createResponse.status).toBe(201);
    const { data } = (await createResponse.json()) as { data: { id: string } };

    const publishResponse = await request(`/postings/${data.id}/publish`, {
      method: "POST",
      headers: owner.headers(),
    });
    expect(publishResponse.status).toBe(200);

    return data.id;
  }

  async function backdateExpiry(postingId: string): Promise<void> {
    await persistenceApp.prisma.posting.update({
      where: { id: postingId },
      data: { expiresAt: new Date(Date.now() - DAY_IN_MS) },
    });
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("rejects an expiry date in the past and persists a future one", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const pastResponse = await request("/postings", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify(
        buildCreatePostingBody({
          expiresAt: new Date(Date.now() - DAY_IN_MS).toISOString(),
        }),
      ),
    });
    expect(pastResponse.status).toBe(400);

    // Deliberately not a day boundary: the API must snap whatever instant a
    // client sends to the end of its UTC day, so every client observes the same
    // calendar-day semantics the contract documents.
    const requested = new Date(Date.now() + 30 * DAY_IN_MS);
    requested.setUTCHours(9, 15, 0, 0);
    const postingId = await createPublishedPosting(
      owner,
      requested.toISOString(),
    );

    const stored = await persistenceApp.prisma.posting.findUniqueOrThrow({
      where: { id: postingId },
    });
    expect(stored.expiresAt?.toISOString()).toBe(
      new Date(
        Date.UTC(
          requested.getUTCFullYear(),
          requested.getUTCMonth(),
          requested.getUTCDate(),
          23,
          59,
          59,
          999,
        ),
      ).toISOString(),
    );
    expect(stored.status).toBe("published");
  }, 120_000);

  it("pauses a due posting, pulls it from public reads, and leaves it on the owner dashboard", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const postingId = await createPublishedPosting(
      owner,
      new Date(Date.now() + 30 * DAY_IN_MS).toISOString(),
    );
    await backdateExpiry(postingId);

    const processed = await resolveExpiryService().expireDuePostings(10);
    expect(processed).toBe(1);

    const expired = await persistenceApp.prisma.posting.findUniqueOrThrow({
      where: { id: postingId },
    });
    expect(expired.status).toBe("paused");
    expect(expired.pausedAt).not.toBeNull();

    const outbox = await persistenceApp.prisma.postingSearchOutbox.findMany({
      where: { postingId },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(outbox[0]?.operation).toBe("delete");

    // Public reads go through isPostingPubliclyVisible, which already excludes
    // `paused` — this is why expiry reuses that status.
    const publicResponse = await request(`/postings/${postingId}`);
    expect(publicResponse.status).toBe(404);

    const ownerResponse = await request("/postings/me?status=paused", {
      headers: owner.headers(),
    });
    expect(ownerResponse.status).toBe(200);
    const ownerBody = (await ownerResponse.json()) as {
      data: { postings: Array<{ id: string }> };
    };
    expect(ownerBody.data.postings.map((posting) => posting.id)).toContain(
      postingId,
    );
  }, 120_000);

  it("records the expiry as a system audit entry", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const postingId = await createPublishedPosting(
      owner,
      new Date(Date.now() + 30 * DAY_IN_MS).toISOString(),
    );
    await backdateExpiry(postingId);

    await resolveExpiryService().expireDuePostings(10);

    const audit = await persistenceApp.prisma.organizationAuditLog.findFirst({
      where: { resourceId: postingId, action: "posting.expired" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBeNull();
    expect(audit?.restorable).toBe(false);
  }, 120_000);

  it("blocks unpausing until the owner moves the expiry date forward", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const postingId = await createPublishedPosting(
      owner,
      new Date(Date.now() + 30 * DAY_IN_MS).toISOString(),
    );
    await backdateExpiry(postingId);
    await resolveExpiryService().expireDuePostings(10);

    const blocked = await request(`/postings/${postingId}/unpause`, {
      method: "POST",
      headers: owner.headers(),
    });
    expect(blocked.status).toBe(400);

    // Stamp the reminder so the update path can be seen clearing it.
    await persistenceApp.prisma.posting.update({
      where: { id: postingId },
      data: { expiryReminderSentAt: new Date() },
    });

    const nextExpiry = new Date(Date.now() + 60 * DAY_IN_MS).toISOString();
    const { availabilityBlocks: _blocks, ...updateBody } =
      buildCreatePostingBody({ expiresAt: nextExpiry });
    const updateResponse = await request(`/postings/${postingId}`, {
      method: "PUT",
      headers: owner.headers(),
      body: JSON.stringify(updateBody),
    });
    expect(updateResponse.status).toBe(200);

    const updated = await persistenceApp.prisma.posting.findUniqueOrThrow({
      where: { id: postingId },
    });
    // Moving the date re-arms exactly one new reminder.
    expect(updated.expiryReminderSentAt).toBeNull();

    const unpauseResponse = await request(`/postings/${postingId}/unpause`, {
      method: "POST",
      headers: owner.headers(),
    });
    expect(unpauseResponse.status).toBe(200);
  }, 120_000);

  it("enqueues exactly one expiry reminder per posting", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const postingId = await createPublishedPosting(
      owner,
      new Date(Date.now() + 2 * DAY_IN_MS).toISOString(),
    );

    const service = resolveExpiryService();
    const first = await service.sendDueExpiryReminders(50, 3);
    expect(first).toBeGreaterThanOrEqual(1);

    const stamped = await persistenceApp.prisma.posting.findUniqueOrThrow({
      where: { id: postingId },
    });
    expect(stamped.expiryReminderSentAt).not.toBeNull();

    const messages = await peekRabbitMqMessages<{
      kind: string;
      input: { postingId: string };
    }>(persistenceApp.infra.rabbitMq, EMAIL_QUEUE_NAME, 50);
    const reminders = messages.filter(
      (message) =>
        message.payload.kind === "posting_expiring_soon" &&
        message.payload.input.postingId === postingId,
    );
    expect(reminders).toHaveLength(1);

    // The IS NULL latch is what makes a second sweep a no-op.
    const second = await service.sendDueExpiryReminders(50, 3);
    const secondCandidateIds = await persistenceApp.prisma.posting.findMany({
      where: { id: postingId, expiryReminderSentAt: null },
    });
    expect(secondCandidateIds).toHaveLength(0);
    expect(second).toBe(0);
  }, 120_000);

  it("keeps new bookings blocked while letting owners settle in-flight ones", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const renter = await createAuthenticatedRequestContext({
      email: "user5@rentify.local",
    });
    const postingId = await createPublishedPosting(
      owner,
      new Date(Date.now() + 30 * DAY_IN_MS).toISOString(),
    );

    const startAt = new Date(Date.now() + 10 * DAY_IN_MS);
    const endAt = new Date(Date.now() + 12 * DAY_IN_MS);
    const bookingResponse = await request(
      `/postings/${postingId}/booking-requests`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          contactName: "Renter One",
          contactEmail: "user5@rentify.local",
          guestCount: 2,
        }),
      },
    );
    expect(bookingResponse.status).toBe(201);
    const booking = (await bookingResponse.json()) as {
      data: { id: string };
    };

    await backdateExpiry(postingId);
    await resolveExpiryService().expireDuePostings(10);

    // A new request is refused: the posting is paused.
    const newBooking = await request(
      `/postings/${postingId}/booking-requests`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          startAt: new Date(Date.now() + 20 * DAY_IN_MS).toISOString(),
          endAt: new Date(Date.now() + 22 * DAY_IN_MS).toISOString(),
          contactName: "Renter One",
          contactEmail: "user5@rentify.local",
          guestCount: 2,
        }),
      },
    );
    expect(newBooking.status).toBeGreaterThanOrEqual(400);

    // The request that already existed can still be settled — stranding a
    // renter who booked before the date passed would be the wrong outcome.
    const approveResponse = await request(
      `/booking-requests/${booking.data.id}/approve`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({}),
      },
    );
    expect(approveResponse.status).toBe(200);
  }, 120_000);
});
