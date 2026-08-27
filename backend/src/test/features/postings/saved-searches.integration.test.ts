import { containerTokens } from "@/configuration/bootstrap/container";
import { buildApiPath } from "@/configuration/http/api-path";
import { MAX_SAVED_SEARCHES_PER_USER } from "@/features/postings/saved-searches/saved-searches.model";
import type { SavedSearchAlertService } from "@/features/postings/saved-searches/saved-search-alert.service";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { peekRabbitMqMessages } from "../../support/live-rabbitmq";

const EMAIL_QUEUE_NAME = "email.delivery.main";

const sweepConfig = {
  batchSize: 25,
  instantIntervalMs: 300_000,
  dailyIntervalMs: 86_400_000,
};

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
    name: "Saved Search Test Workspace",
    description: "Bright loft used to exercise the saved search alert sweep.",
    pricing: {
      currency: "cad",
      daily: {
        amount: 155,
      },
    },
    photos: [buildPostingPhoto("postings/saved-search-workspace.jpg")],
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

describe("saved searches persistence", () => {
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

  function resolveAlertService(): SavedSearchAlertService {
    const scope = persistenceApp.container.createScope();
    return scope.resolve(containerTokens.savedSearchAlertService);
  }

  async function createSavedSearch(
    renter: Awaited<ReturnType<typeof createAuthenticatedRequestContext>>,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return request("/postings/saved/searches", {
      method: "POST",
      headers: renter.headers(),
      body: JSON.stringify(body),
    });
  }

  async function createPublishedPosting(
    owner: Awaited<ReturnType<typeof createAuthenticatedRequestContext>>,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const createResponse = await request("/postings", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify(buildCreatePostingBody(overrides)),
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

  /**
   * Programs the stubbed public search service.
   *
   * The harness replaces the Elasticsearch-backed search with a stub, and the
   * indexer workers do not run here, so a freshly published posting is not
   * discoverable through the real engine. Driving the stub keeps these tests
   * about what they are actually for: that the sweep persists its seen set and
   * lands a real job on the real queue.
   */
  function stubSearchResults(postingIds: string[]): void {
    persistenceApp.stubs.postingsPublicSearchService.searchPublic.mockImplementation(
      async () => ({
        postings: postingIds.map((id) => ({ id })),
        pagination: {
          page: 1,
          pageSize: 50,
          total: postingIds.length,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        source: "elasticsearch",
      }),
    );
  }

  /** Brings a search forward so the next sweep claims it without waiting. */
  async function makeDue(savedSearchId: string): Promise<void> {
    await persistenceApp.prisma.savedSearch.update({
      where: { id: savedSearchId },
      data: { nextCheckAt: new Date(Date.now() - 60_000) },
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

  it("creates, lists, renames, reschedules, and deletes a saved search", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    // Deliberately not one of the seeded searches: those already occupy their
    // owner's (user, filters) uniqueness slot and would come back 409.
    const createResponse = await createSavedSearch(renter, {
      queryParams: { q: "crofters lighthouse cottage", family: "place" },
      notifyFrequency: "instant",
    });
    expect(createResponse.status).toBe(201);

    const created = (await createResponse.json()) as {
      data: { id: string; name: string; notifyFrequency: string };
    };
    // No name was given, so one is derived from the filters rather than the
    // row landing in the list as an unidentifiable "Saved search".
    expect(created.data.name).toContain("crofters lighthouse cottage");

    const listResponse = await request("/postings/saved/searches", {
      headers: renter.headers(),
    });
    expect(listResponse.status).toBe(200);

    const listed = (await listResponse.json()) as {
      data: {
        searches: Array<{ id: string }>;
        limit: number;
      };
    };
    expect(listed.data.searches.map((search) => search.id)).toContain(
      created.data.id,
    );
    expect(listed.data.limit).toBe(MAX_SAVED_SEARCHES_PER_USER);

    const updateResponse = await request(
      `/postings/saved/searches/${created.data.id}`,
      {
        method: "PATCH",
        headers: renter.headers(),
        body: JSON.stringify({ name: "Cottage watch", notifyFrequency: "off" }),
      },
    );
    expect(updateResponse.status).toBe(200);

    const updated = (await updateResponse.json()) as {
      data: { name: string; notifyFrequency: string };
    };
    expect(updated.data.name).toBe("Cottage watch");
    expect(updated.data.notifyFrequency).toBe("off");

    // Turning alerts off has to take the search off the sweep, or it keeps its
    // old schedule and keeps being claimed.
    const stored = await persistenceApp.prisma.savedSearch.findUniqueOrThrow({
      where: { id: created.data.id },
    });
    expect(stored.nextCheckAt).toBeNull();

    const deleteResponse = await request(
      `/postings/saved/searches/${created.data.id}`,
      { method: "DELETE", headers: renter.headers() },
    );
    expect(deleteResponse.status).toBe(204);

    expect(
      await persistenceApp.prisma.savedSearch.findUnique({
        where: { id: created.data.id },
      }),
    ).toBeNull();
  }, 120_000);

  it("rejects saving the same filters twice", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const body = {
      queryParams: { q: "duplicate guard", family: "place" },
      notifyFrequency: "instant",
    };

    expect((await createSavedSearch(renter, body)).status).toBe(201);

    // The same filters in a different order must still collide: the guard
    // hashes a canonical projection, not the request body.
    const duplicate = await createSavedSearch(renter, {
      notifyFrequency: "instant",
      queryParams: { family: "place", q: "duplicate guard" },
    });
    expect(duplicate.status).toBe(409);
  }, 120_000);

  it("rejects a search with no filters", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    const response = await createSavedSearch(renter, { queryParams: {} });

    expect(response.status).toBe(400);
  }, 120_000);

  it("stops a visitor saving past the per-account cap", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    // The seed gives this account a search of its own, so the cap is measured
    // from what is already there rather than from zero.
    const existingResponse = await request("/postings/saved/searches", {
      headers: renter.headers(),
    });
    const existing = (await existingResponse.json()) as {
      data: { pagination: { total: number } };
    };
    const remaining =
      MAX_SAVED_SEARCHES_PER_USER - existing.data.pagination.total;
    expect(remaining).toBeGreaterThan(0);

    for (let index = 0; index < remaining; index += 1) {
      const response = await createSavedSearch(renter, {
        queryParams: { q: `cap probe ${index}` },
        notifyFrequency: "off",
      });
      expect(response.status).toBe(201);
    }

    const overflow = await createSavedSearch(renter, {
      queryParams: { q: "one too many" },
      notifyFrequency: "off",
    });
    expect(overflow.status).toBe(422);
  }, 180_000);

  it("keeps one visitor out of another visitor's saved searches", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const other = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    const createResponse = await createSavedSearch(owner, {
      queryParams: { q: "private to user one" },
      notifyFrequency: "off",
    });
    const created = (await createResponse.json()) as { data: { id: string } };

    const listResponse = await request("/postings/saved/searches", {
      headers: other.headers(),
    });
    const listed = (await listResponse.json()) as {
      data: { searches: Array<{ id: string }> };
    };
    expect(listed.data.searches.map((search) => search.id)).not.toContain(
      created.data.id,
    );

    // Ownership is enforced in the write itself, not by a prior read, so a
    // mismatched caller changes nothing rather than editing someone else's row.
    const patchResponse = await request(
      `/postings/saved/searches/${created.data.id}`,
      {
        method: "PATCH",
        headers: other.headers(),
        body: JSON.stringify({ name: "Mine now" }),
      },
    );
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await request(
      `/postings/saved/searches/${created.data.id}`,
      { method: "DELETE", headers: other.headers() },
    );
    expect(deleteResponse.status).toBe(404);

    expect(
      await persistenceApp.prisma.savedSearch.findUniqueOrThrow({
        where: { id: created.data.id },
      }),
    ).toMatchObject({ name: expect.not.stringContaining("Mine now") });
  }, 120_000);

  it("requires authentication", async () => {
    expect((await request("/postings/saved/searches")).status).toBe(401);
    expect(
      (
        await request("/postings/saved/searches", {
          method: "POST",
          // Content type included on purpose: without it the request is
          // rejected as unsupported media before authentication is reached,
          // which would pass the endpoint without proving it is guarded.
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ queryParams: { q: "anonymous" } }),
        })
      ).status,
    ).toBe(401);
  }, 120_000);

  it("clears the new-match badge through the seen endpoint", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    const createResponse = await createSavedSearch(renter, {
      queryParams: { q: "badge probe" },
      notifyFrequency: "off",
    });
    const created = (await createResponse.json()) as { data: { id: string } };

    await persistenceApp.prisma.savedSearch.update({
      where: { id: created.data.id },
      data: { newMatchCount: 4 },
    });

    const seenResponse = await request(
      `/postings/saved/searches/${created.data.id}/seen`,
      { method: "POST", headers: renter.headers() },
    );
    expect(seenResponse.status).toBe(204);

    expect(
      await persistenceApp.prisma.savedSearch.findUniqueOrThrow({
        where: { id: created.data.id },
      }),
    ).toMatchObject({ newMatchCount: 0 });
  }, 120_000);

  it("emails the owner when a posting starts matching a saved search", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    // A term nothing currently matches: this is the case the whole feature
    // exists for, and it also makes the baseline trivially empty.
    const uniqueTerm = `zzqx${Date.now()}`;
    stubSearchResults([]);

    const createResponse = await createSavedSearch(renter, {
      queryParams: { q: uniqueTerm },
      notifyFrequency: "instant",
    });
    expect(createResponse.status).toBe(201);

    const created = (await createResponse.json()) as { data: { id: string } };
    const alertService = resolveAlertService();

    // Nothing matches yet, so a sweep now must not alert.
    await makeDue(created.data.id);
    await alertService.runSweep(sweepConfig);
    expect(
      await persistenceApp.prisma.savedSearchSeenPosting.count({
        where: { savedSearchId: created.data.id },
      }),
    ).toBe(0);

    const postingId = await createPublishedPosting(owner, {
      name: `Loft ${uniqueTerm}`,
    });
    stubSearchResults([postingId]);

    await makeDue(created.data.id);
    await alertService.runSweep(sweepConfig);

    const seen = await persistenceApp.prisma.savedSearchSeenPosting.findMany({
      where: { savedSearchId: created.data.id },
    });
    expect(seen.map((row) => row.postingId)).toEqual([postingId]);

    const afterAlert =
      await persistenceApp.prisma.savedSearch.findUniqueOrThrow({
        where: { id: created.data.id },
      });
    expect(afterAlert.newMatchCount).toBe(1);
    expect(afterAlert.lastNotifiedAt).not.toBeNull();

    const messages = await peekRabbitMqMessages<{
      kind: string;
      input: { savedSearchId: string; postingIds: string[] };
    }>(persistenceApp.infra.rabbitMq, EMAIL_QUEUE_NAME, 50);
    const alerts = messages.filter(
      (message) =>
        message.payload.kind === "saved_search_matches" &&
        message.payload.input.savedSearchId === created.data.id,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].payload.input.postingIds).toEqual([postingId]);

    // A second sweep must stay quiet: the match has already been reported.
    await makeDue(created.data.id);
    await alertService.runSweep(sweepConfig);
    expect(
      await persistenceApp.prisma.savedSearchSeenPosting.count({
        where: { savedSearchId: created.data.id },
      }),
    ).toBe(1);
  }, 180_000);

  it("does not alert on postings that already matched when the search was saved", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const uniqueTerm = `zzqy${Date.now()}`;
    const postingId = await createPublishedPosting(owner, {
      name: `Loft ${uniqueTerm}`,
    });
    // The posting already matches at the moment of saving, which is exactly
    // the situation the create-time baseline exists to handle.
    stubSearchResults([postingId]);

    const createResponse = await createSavedSearch(renter, {
      queryParams: { q: uniqueTerm },
      notifyFrequency: "instant",
    });
    const created = (await createResponse.json()) as { data: { id: string } };

    // The visitor was looking at those results when they pressed save, so the
    // baseline must have recorded them and the first sweep must stay quiet.
    const baselined = await persistenceApp.prisma.savedSearchSeenPosting.count({
      where: { savedSearchId: created.data.id },
    });
    expect(baselined).toBeGreaterThan(0);

    await makeDue(created.data.id);
    await resolveAlertService().runSweep(sweepConfig);

    expect(
      await persistenceApp.prisma.savedSearch.findUniqueOrThrow({
        where: { id: created.data.id },
      }),
    ).toMatchObject({ newMatchCount: 0, lastNotifiedAt: null });
  }, 180_000);
});
