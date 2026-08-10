import { buildApiPath } from "@/configuration/http/api-path";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const FLAG_NAME = "payments.new-checkout";

describe("Feature flag admin persistence integration", () => {
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

  async function request(
    path: string,
    init: RequestInit & { headers?: Record<string, string> } = {},
  ): Promise<Response> {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  it("sets, lists, and clears a feature flag override", async () => {
    const admin = await createAuthenticatedRequestContext({
      email: "admin1@rentify.local",
    });

    const setResponse = await request(`/admin/feature-flags/${FLAG_NAME}`, {
      method: "PUT",
      headers: admin.headers(),
      body: JSON.stringify({
        enabled: true,
        description: "Enables the redesigned checkout flow.",
        group: "payments",
      }),
    });
    expect(setResponse.status).toBe(200);
    await expect(setResponse.json()).resolves.toMatchObject({
      data: { name: FLAG_NAME, enabled: true, source: "db" },
    });

    const listResponse = await request("/admin/feature-flags", {
      headers: admin.headers(),
    });
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as {
      data: Array<{ name: string; enabled: boolean; source: string }>;
    };
    expect(listBody.data).toContainEqual(
      expect.objectContaining({
        name: FLAG_NAME,
        enabled: true,
        source: "db",
      }),
    );

    const deleteResponse = await request(`/admin/feature-flags/${FLAG_NAME}`, {
      method: "DELETE",
      headers: admin.headers(),
    });
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toMatchObject({
      data: {
        name: FLAG_NAME,
        deletedOverride: true,
        effectiveSource: "default",
      },
    });

    // The override is gone, so the flag falls back to its built-in default.
    const listAfterDelete = (await (
      await request("/admin/feature-flags", { headers: admin.headers() })
    ).json()) as {
      data: Array<{ name: string; source: string }>;
    };
    expect(
      listAfterDelete.data.find((flag) => flag.name === FLAG_NAME)?.source,
    ).not.toBe("db");
  });

  it("refuses feature flag administration to a non-admin", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    const listResponse = await request("/admin/feature-flags", {
      headers: renter.headers(),
    });
    expect(listResponse.status).toBe(403);

    const setResponse = await request(`/admin/feature-flags/${FLAG_NAME}`, {
      method: "PUT",
      headers: renter.headers(),
      body: JSON.stringify({ enabled: true }),
    });
    expect(setResponse.status).toBe(403);
  });
});
