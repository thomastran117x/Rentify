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

  describe("username change cooldown", () => {
    async function updateUsername(
      user: Awaited<ReturnType<typeof createAuthenticatedRequestContext>>,
      username: string,
      extra: Record<string, unknown> = {},
    ): Promise<Response> {
      return request("/profile/me", {
        method: "PUT",
        headers: user.headers(),
        body: JSON.stringify({ username, ...extra }),
      });
    }

    it("allows the first rename and then blocks a second one", async () => {
      const user = await createAuthenticatedRequestContext({
        email: "user1@rentify.local",
      });

      expect((await updateUsername(user, "renter-one-first")).status).toBe(200);

      const second = await updateUsername(user, "renter-one-second");
      expect(second.status).toBe(429);
      const body = (await second.json()) as {
        error: { code: string; details: { cooldownDays: number } };
      };
      expect(body.error.code).toBe("USERNAME_CHANGE_COOLDOWN");
      expect(body.error.details.cooldownDays).toBe(30);

      // The rejected rename must not have been written.
      expect(
        await persistenceApp.prisma.profile.findUniqueOrThrow({
          where: { userId: user.userId },
        }),
      ).toMatchObject({ username: "renter-one-first" });
    });

    it("does not spend the cooldown when the username is resent unchanged", async () => {
      // The PUT body always carries a username, so an ordinary profile save
      // must leave the allowance intact.
      const user = await createAuthenticatedRequestContext({
        email: "user1@rentify.local",
      });

      expect(
        (await updateUsername(user, "renter-one", { isPrivate: true })).status,
      ).toBe(200);

      const profile = await persistenceApp.prisma.profile.findUniqueOrThrow({
        where: { userId: user.userId },
      });
      expect(profile.usernameChangedAt).toBeNull();

      // Still free to rename afterwards.
      expect((await updateUsername(user, "renter-one-renamed")).status).toBe(
        200,
      );
    });

    it("lets only one of two concurrent renames through", async () => {
      // Both requests read the same eligible row before either writes. The
      // eligibility test lives in the UPDATE's WHERE clause, so the database
      // arbitrates and the loser changes nothing.
      const user = await createAuthenticatedRequestContext({
        email: "user1@rentify.local",
      });

      const [first, second] = await Promise.all([
        updateUsername(user, "renter-one-race-a"),
        updateUsername(user, "renter-one-race-b"),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 429]);

      const stored = await persistenceApp.prisma.profile.findUniqueOrThrow({
        where: { userId: user.userId },
      });
      expect(["renter-one-race-a", "renter-one-race-b"]).toContain(
        stored.username,
      );
      expect(stored.usernameChangedAt).not.toBeNull();

      // And the account is now genuinely locked.
      expect((await updateUsername(user, "renter-one-race-c")).status).toBe(
        429,
      );
    });

    it("reports the cooldown state for a user seeded inside the window", async () => {
      const user = await createAuthenticatedRequestContext({
        email: "user2@rentify.local",
      });

      const response = await request("/profile/me", {
        headers: user.headers(),
      });

      const data = await readData<{
        username: string;
        canChangeUsername: boolean;
        usernameChangeAvailableAt: string;
      }>(response);

      expect(data.username).toBe("renter-two");
      expect(data.canChangeUsername).toBe(false);
      expect(
        new Date(data.usernameChangeAvailableAt).getTime(),
      ).toBeGreaterThan(Date.now());
    });
  });
});
