import { buildApiPath } from "@/configuration/http/api-path";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

describe("Profiles persistence integration", () => {
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

  async function readData<TData>(response: Response): Promise<TData> {
    const body = (await response.json()) as { data: TData };
    return body.data;
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

  it("lists public profiles with pagination", async () => {
    const response = await request("/profiles?page=1&pageSize=5");

    expect(response.status).toBe(200);
    const body = await readData<{
      profiles: Array<{ username: string }>;
      pagination: { page: number; pageSize: number; total: number };
    }>(response);

    expect(body.pagination).toMatchObject({ page: 1, pageSize: 5 });
    expect(body.profiles.length).toBeGreaterThan(0);
    expect(body.profiles.length).toBeLessThanOrEqual(5);
  });

  it("reads and updates the signed-in user's profile", async () => {
    const user = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    const readResponse = await request("/profile/me", {
      headers: user.headers(),
    });
    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({
      data: { userId: user.userId, username: "renter-one" },
    });

    const updateResponse = await request("/profile/me", {
      method: "PUT",
      headers: user.headers(),
      body: JSON.stringify({
        username: "renter-one-updated",
        phoneNumber: "+1 416 555 0100",
        isPrivate: true,
        recommendationPersonalizationEnabled: false,
      }),
    });
    expect(updateResponse.status).toBe(200);

    expect(
      await persistenceApp.prisma.profile.findUniqueOrThrow({
        where: { userId: user.userId },
      }),
    ).toMatchObject({
      username: "renter-one-updated",
      isPrivate: true,
      recommendationPersonalizationEnabled: false,
    });

    // The update must be observable through a later read.
    const rereadResponse = await request("/profile/me", {
      headers: user.headers(),
    });
    await expect(rereadResponse.json()).resolves.toMatchObject({
      data: { username: "renter-one-updated", isPrivate: true },
    });
  });

  it("rejects reading the signed-in profile without a token", async () => {
    const response = await request("/profile/me");

    expect(response.status).toBe(401);
  });
});
