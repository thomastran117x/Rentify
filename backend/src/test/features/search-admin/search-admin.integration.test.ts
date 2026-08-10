import { buildApiPath } from "@/configuration/http/api-path";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

/**
 * The posting, organization, and organization-blog search surfaces expose the
 * same five maintenance operations under different prefixes.
 *
 * `startReindex` only records a run row; the indexing itself is done by a
 * worker, so these run quickly against the real database and Elasticsearch.
 *
 * Declared as a plain function rather than `describe.each` so each request
 * site's `basePath` resolves statically for the coverage checker.
 */
let persistenceApp: PersistenceTestApp;

// One shared harness for the whole file: the persistence app is a module-level
// singleton, so per-describe setup and teardown would tear it down while the
// later suites still need it.
beforeAll(async () => {
  persistenceApp = await createPersistenceTestApp();
}, 180_000);

beforeEach(async () => {
  await resetPersistenceState();
}, 180_000);

afterAll(async () => {
  await teardownPersistenceTestApp();
}, 180_000);

function describeSearchAdminSuite(suiteName: string, basePath: string) {
  describe(`${suiteName} persistence integration`, () => {
    it("starts a reindex run and reads it back by id", async () => {
      const admin = await createAuthenticatedRequestContext({
        email: "admin1@rentify.local",
      });

      const startResponse = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`${basePath}/reindex`)}`,
        {
          method: "POST",
          headers: admin.headers(),
        },
      );
      expect(startResponse.status).toBe(202);

      const started = (await startResponse.json()) as {
        data: { id: string; status: string };
      };
      expect(started.data.id).toBeTruthy();

      const runResponse = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`${basePath}/reindex-runs/${started.data.id}`)}`,
        { headers: admin.headers() },
      );
      expect(runResponse.status).toBe(200);

      // The posting surface returns the run flat while the organization
      // surfaces nest it under `run`.
      const runBody = (await runResponse.json()) as {
        data: { id?: string; run?: { id?: string } };
      };
      expect(runBody.data.run?.id ?? runBody.data.id).toBe(started.data.id);

      // A second start must conflict while the first run is still active.
      const secondStartResponse = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`${basePath}/reindex`)}`,
        {
          method: "POST",
          headers: admin.headers(),
        },
      );
      expect(secondStartResponse.status).toBe(409);
    });

    it("reports index status", async () => {
      const admin = await createAuthenticatedRequestContext({
        email: "admin1@rentify.local",
      });

      const response = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`${basePath}/status`)}`,
        {
          headers: admin.headers(),
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: expect.objectContaining({ aliases: expect.any(Object) }),
      });
    });

    it("replays dead-lettered outbox entries", async () => {
      const admin = await createAuthenticatedRequestContext({
        email: "admin1@rentify.local",
      });

      const response = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`${basePath}/outbox/replay-dead-lettered?limit=25`)}`,
        { method: "POST", headers: admin.headers() },
      );

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        data: expect.objectContaining({ revived: expect.any(Number) }),
      });
    });

    it("cleans up retained indices", async () => {
      const admin = await createAuthenticatedRequestContext({
        email: "admin1@rentify.local",
      });

      const response = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`${basePath}/cleanup-retained-indices`)}`,
        {
          method: "POST",
          headers: admin.headers(),
        },
      );

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        data: expect.objectContaining({ deleted: expect.any(Number) }),
      });
    });

    it("refuses every maintenance operation to a non-admin", async () => {
      const renter = await createAuthenticatedRequestContext({
        email: "user1@rentify.local",
      });

      expect(
        (
          await persistenceApp.app.request(
            `http://rent.test${buildApiPath(`${basePath}/status`)}`,
            { headers: renter.headers() },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await persistenceApp.app.request(
            `http://rent.test${buildApiPath(`${basePath}/reindex`)}`,
            {
              method: "POST",
              headers: renter.headers(),
            },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await persistenceApp.app.request(
            `http://rent.test${buildApiPath(`${basePath}/cleanup-retained-indices`)}`,
            {
              method: "POST",
              headers: renter.headers(),
            },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await persistenceApp.app.request(
            `http://rent.test${buildApiPath(`${basePath}/outbox/replay-dead-lettered`)}`,
            {
              method: "POST",
              headers: renter.headers(),
            },
          )
        ).status,
      ).toBe(403);
    });
  });
}

describeSearchAdminSuite("Posting search admin", "/admin/search");
describeSearchAdminSuite(
  "Organization search admin",
  "/admin/organizations/search",
);
describeSearchAdminSuite(
  "Organization blog search admin",
  "/admin/organizations/blog-search",
);
