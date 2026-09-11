import { buildApiPath } from "@/configuration/http/api-path";
import { RECENTLY_VIEWED_CAP } from "@/features/postings/recently-viewed/recently-viewed.model";
import { SEED_POSTINGS } from "@/seeds/fixtures/postings";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

/**
 * Exercises the recently viewed history end to end against the live stack.
 *
 * Note that this suite mutates `user1@rentify.local`'s seeded history. No other
 * suite reads those rows, and `resetPersistenceState` restores the seed
 * snapshot between tests, so the mutation does not leak.
 */
describe("Recently viewed postings", () => {
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

  type Renter = Awaited<ReturnType<typeof createAuthenticatedRequestContext>>;

  /**
   * Seeded published postings, taken from the fixtures rather than from
   * `GET /postings`: the public search reads Elasticsearch, which is not
   * indexed against the test schema, so it returns nothing here.
   */
  function listPublicPostingIds(limit: number): string[] {
    const ids = SEED_POSTINGS.filter(
      (posting) => posting.status === "published",
    ).map((posting) => posting.id);

    expect(ids.length).toBeGreaterThanOrEqual(limit);

    return ids.slice(0, limit);
  }

  async function trackView(
    postingId: string,
    renter?: Renter,
  ): Promise<Response> {
    return request(`/postings/${postingId}/activity/view`, {
      method: "POST",
      headers: renter ? renter.headers() : undefined,
    });
  }

  async function listRecentlyViewed(renter: Renter) {
    const response = await request("/postings/recently-viewed", {
      headers: renter.headers(),
    });
    expect(response.status).toBe(200);

    const body = await response.json();

    return body.data as {
      postings: { id: string; viewedAt: string }[];
      trackingEnabled: boolean;
    };
  }

  async function clearHistory(renter: Renter): Promise<void> {
    const response = await request("/postings/recently-viewed", {
      method: "DELETE",
      headers: renter.headers(),
    });
    expect(response.status).toBe(204);
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

  it("accepts an anonymous view without recording anything", async () => {
    const [postingId] = listPublicPostingIds(1);
    const renter = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    const response = await trackView(postingId);

    expect(response.status).toBe(202);

    // user2 has no seeded history, so an anonymous view leaking into an account
    // would be visible here.
    const result = await listRecentlyViewed(renter);
    expect(result.postings).toHaveLength(0);
  });

  it("orders by last view and keeps one entry per posting", async () => {
    const [first, second] = listPublicPostingIds(2);
    const renter = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    expect((await trackView(first, renter)).status).toBe(202);
    expect((await trackView(second, renter)).status).toBe(202);
    expect((await trackView(first, renter)).status).toBe(202);

    const result = await listRecentlyViewed(renter);

    // Re-viewing promotes rather than duplicating.
    expect(result.postings.map((posting) => posting.id)).toEqual([
      first,
      second,
    ]);
    expect(result.trackingEnabled).toBe(true);
  });

  it("merges a local history and never demotes a newer server entry", async () => {
    const [serverSide, localOnly] = listPublicPostingIds(2);
    const renter = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    // Recorded now, so the server row is the newer of the two.
    expect((await trackView(serverSide, renter)).status).toBe(202);

    const syncResponse = await request("/postings/recently-viewed/sync", {
      method: "POST",
      headers: renter.headers(),
      body: JSON.stringify({
        entries: [
          { postingId: serverSide, viewedAt: "2026-09-01T00:00:00.000Z" },
          { postingId: localOnly, viewedAt: "2026-09-02T00:00:00.000Z" },
        ],
      }),
    });

    expect(syncResponse.status).toBe(200);

    const body = await syncResponse.json();
    const postings = body.data.postings as { id: string; viewedAt: string }[];

    // Both sides survive the merge.
    expect(postings.map((posting) => posting.id).sort()).toEqual(
      [serverSide, localOnly].sort(),
    );

    // The stale local claim did not drag the server row backwards, so the
    // freshly viewed posting still leads.
    expect(postings[0].id).toBe(serverSide);
  });

  it("resolves history across two devices that both sync after a shared sign-in", async () => {
    const [x, y, z] = listPublicPostingIds(3);
    const renter = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    // Device 1 (say, a phone): browsed X then Y while signed out, then signs
    // in and syncs its local mirror up.
    const device1Response = await request("/postings/recently-viewed/sync", {
      method: "POST",
      headers: renter.headers(),
      body: JSON.stringify({
        entries: [
          { postingId: x, viewedAt: "2026-09-01T00:00:00.000Z" },
          { postingId: y, viewedAt: "2026-09-01T01:00:00.000Z" },
        ],
      }),
    });

    expect(device1Response.status).toBe(200);

    // Device 2 (say, a laptop): independently browsed Y again more recently,
    // plus a posting device 1 never saw, then signs in to the same account.
    const device2Response = await request("/postings/recently-viewed/sync", {
      method: "POST",
      headers: renter.headers(),
      body: JSON.stringify({
        entries: [
          { postingId: y, viewedAt: "2026-09-02T00:00:00.000Z" },
          { postingId: z, viewedAt: "2026-09-01T12:00:00.000Z" },
        ],
      }),
    });

    expect(device2Response.status).toBe(200);

    const result = await listRecentlyViewed(renter);

    // Every posting either device saw survives the merge.
    expect(result.postings.map((posting) => posting.id).sort()).toEqual(
      [x, y, z].sort(),
    );

    // Ordered newest-view-first across both devices: device 2's re-view of Y
    // is the most recent event of all, ahead of its own Z, ahead of device
    // 1's untouched X.
    expect(result.postings.map((posting) => posting.id)).toEqual([y, z, x]);
  });

  it("clamps a future timestamp instead of rejecting the batch", async () => {
    const [postingId] = listPublicPostingIds(1);
    const renter = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    const response = await request("/postings/recently-viewed/sync", {
      method: "POST",
      headers: renter.headers(),
      body: JSON.stringify({
        entries: [{ postingId, viewedAt: "2099-01-01T00:00:00.000Z" }],
      }),
    });

    expect(response.status).toBe(200);

    const body = await response.json();
    const [entry] = body.data.postings as { viewedAt: string }[];

    expect(new Date(entry.viewedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("rejects a batch larger than the sync limit", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });
    const postingIds = listPublicPostingIds(1);

    const response = await request("/postings/recently-viewed/sync", {
      method: "POST",
      headers: renter.headers(),
      body: JSON.stringify({
        entries: Array.from({ length: 51 }, () => ({
          postingId: postingIds[0],
          viewedAt: "2026-09-01T00:00:00.000Z",
        })),
      }),
    });

    expect(response.status).toBe(400);
  });

  it("caps stored history and drops the oldest entries", async () => {
    const overflow = 5;
    const renter = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });
    const postingIds = listPublicPostingIds(RECENTLY_VIEWED_CAP + overflow);

    // The seed set must be large enough for the cap to actually bite.
    expect(postingIds.length).toBeGreaterThan(RECENTLY_VIEWED_CAP);

    // Seeded through sync with explicit, strictly increasing timestamps rather
    // than a loop of live views. `new Date()` is millisecond-precision, so a
    // tight loop can land several views in the same tick, and which of those
    // the prune drops is then decided by its `id` tiebreak -- deterministic in
    // production, where nobody opens 50 postings inside a millisecond, but
    // arbitrary here. Explicit timestamps make "the oldest went" assertable.
    const base = Date.parse("2026-09-01T00:00:00.000Z");
    const entries = postingIds.map((postingId, index) => ({
      postingId,
      viewedAt: new Date(base + index * 60_000).toISOString(),
    }));

    for (let start = 0; start < entries.length; start += RECENTLY_VIEWED_CAP) {
      const response = await request("/postings/recently-viewed/sync", {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          entries: entries.slice(start, start + RECENTLY_VIEWED_CAP),
        }),
      });

      expect(response.status).toBe(200);
    }

    const response = await request(
      `/postings/recently-viewed?limit=${RECENTLY_VIEWED_CAP}`,
      { headers: renter.headers() },
    );
    const body = await response.json();
    const stored = body.data.postings as { id: string }[];

    expect(stored).toHaveLength(RECENTLY_VIEWED_CAP);

    // Exactly the oldest `overflow` entries were pruned, and the newest kept.
    const storedIds = new Set(stored.map((posting) => posting.id));
    expect(postingIds.slice(0, overflow).some((id) => storedIds.has(id))).toBe(
      false,
    );
    expect(storedIds.has(postingIds[postingIds.length - 1])).toBe(true);
  });

  it("removes a single entry idempotently", async () => {
    const [postingId] = listPublicPostingIds(1);
    const renter = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    expect((await trackView(postingId, renter)).status).toBe(202);
    expect((await listRecentlyViewed(renter)).postings).toHaveLength(1);

    for (const attempt of [1, 2]) {
      const response = await request(`/postings/recently-viewed/${postingId}`, {
        method: "DELETE",
        headers: renter.headers(),
      });

      // The second delete must also succeed, so an entry cannot become stuck.
      expect(response.status).toBe(204);
      expect(attempt).toBeGreaterThan(0);
    }

    expect((await listRecentlyViewed(renter)).postings).toHaveLength(0);
  });

  it("clears the whole history", async () => {
    const [first, second] = listPublicPostingIds(2);
    const renter = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    expect((await trackView(first, renter)).status).toBe(202);
    expect((await trackView(second, renter)).status).toBe(202);
    expect((await listRecentlyViewed(renter)).postings).toHaveLength(2);

    await clearHistory(renter);

    expect((await listRecentlyViewed(renter)).postings).toHaveLength(0);

    // Idempotent: clearing an already empty history still succeeds.
    await clearHistory(renter);
  });

  it("stops recording once the caller opts out", async () => {
    const [postingId] = listPublicPostingIds(1);
    const renter = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    const profileResponse = await request("/profile/me", {
      method: "PUT",
      headers: renter.headers(),
      body: JSON.stringify({
        username: "renter-two",
        recentlyViewedTrackingEnabled: false,
      }),
    });
    expect(profileResponse.status).toBe(200);

    expect((await trackView(postingId, renter)).status).toBe(202);

    const result = await listRecentlyViewed(renter);

    expect(result.postings).toHaveLength(0);
    expect(result.trackingEnabled).toBe(false);
  });

  it("requires authentication to read the history", async () => {
    const response = await request("/postings/recently-viewed");

    expect(response.status).toBe(401);
  });
});
