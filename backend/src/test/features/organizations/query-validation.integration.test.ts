import { buildApiPath } from "@/configuration/http/api-path";
import { createFixtureId } from "@/seeds/types";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const ORGANIZATION_ID = createFixtureId(1040, 1);

/**
 * List endpoints validate their query strings through parseRequestQuery, so a
 * bad value is a 400 VALIDATION_ERROR rather than a raw ZodError escaping as
 * a 500.
 */
describe("Organization list query validation integration", () => {
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

  it.each([
    ["organization audit", `/organizations/${ORGANIZATION_ID}/audit`],
    [
      "organization blog management",
      `/organizations/${ORGANIZATION_ID}/blog-posts`,
    ],
    ["published organization blog", `/organizations/${ORGANIZATION_ID}/blog`],
    [
      "organization announcements",
      `/organizations/${ORGANIZATION_ID}/announcements`,
    ],
    ["organization reviews", `/organizations/${ORGANIZATION_ID}/reviews`],
    ["public blog feed", "/blog"],
  ])("rejects a bad %s query with 400", async (_name, path) => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`${path}?pageSize=0`)}`,
      { headers: owner.headers() },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        details: { pageSize: [expect.any(String)] },
      },
    });
  });
});
