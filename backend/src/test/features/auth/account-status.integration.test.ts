import { buildApiPath } from "@/configuration/http/api-path";
import type { AccountStatus } from "@/features/auth/auth.model";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type AuthenticatedRequestContext,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const ORIGIN = "http://localhost:3040";
const PASSWORD = "Rentify123!";
// renter-one is on the harness's MFA bypass list, so a password sign-in that
// passes the status check goes straight to a session.
const USERNAME = "renter-one";
const EMAIL = "user1@rentify.local";

/**
 * The status is written straight to the row, without rotating the token
 * version, so these prove the status check on its own: every token minted
 * before the change still carries the current version.
 */
describe("Durable account status enforcement integration", () => {
  let persistenceApp: PersistenceTestApp;

  function request(path: string, init: RequestInit = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  function login(password = PASSWORD) {
    return request("/auth/local/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-device-id": "account-status-test-device",
      },
      body: JSON.stringify({
        username: USERNAME,
        password,
        captchaToken: "captcha-ok-login",
      }),
    });
  }

  function refresh(context: AuthenticatedRequestContext) {
    return request("/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: context.refreshToken }),
    });
  }

  async function createPat(context: AuthenticatedRequestContext) {
    const response = await request("/auth/personal-access-tokens", {
      method: "POST",
      headers: context.headers({ origin: ORIGIN }),
      body: JSON.stringify({
        name: "Account status suite",
        scopes: ["mcp:read"],
        expiresInDays: 30,
      }),
    });
    expect(response.status).toBe(201);
    const { data } = (await response.json()) as { data: { token: string } };
    return data.token;
  }

  function readProfile(bearer: string) {
    return request("/profile/me", {
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
    });
  }

  function setStatus(status: AccountStatus) {
    return persistenceApp.prisma.user.update({
      where: { email: EMAIL },
      data: { status, statusReason: "Integration test hold" },
    });
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
    await persistenceApp.prisma.authAuditEvent.deleteMany({});
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("seeds every account as active and signs an active account in", async () => {
    const statuses = await persistenceApp.prisma.user.groupBy({
      by: ["status"],
      where: { email: { not: "locked1@rentify.local" } },
      _count: true,
    });

    expect(statuses.map((row) => row.status)).toEqual(["active"]);
    expect((await login()).status).toBe(200);
  });

  it.each([
    {
      status: "locked" as const,
      httpStatus: 423,
      error: {
        code: "ACCOUNT_LOCKED",
        details: { reason: "security_hold", recovery: "password_reset" },
      },
      reasonCode: "account_locked",
    },
    {
      status: "suspended" as const,
      httpStatus: 403,
      error: { code: "ACCOUNT_SUSPENDED" },
      reasonCode: "account_suspended",
    },
  ])(
    "refuses every credential of a $status account",
    async ({ status, httpStatus, error, reasonCode }) => {
      const context = await createAuthenticatedRequestContext({ email: EMAIL });
      const refreshControl = await createAuthenticatedRequestContext({
        email: EMAIL,
      });
      const pat = await createPat(context);
      expect((await readProfile(context.accessToken)).status).toBe(200);
      expect((await readProfile(pat)).status).toBe(200);
      expect((await refresh(refreshControl)).status).toBe(200);

      await setStatus(status);

      expect((await readProfile(context.accessToken)).status).toBe(401);
      expect((await readProfile(pat)).status).toBe(401);
      expect((await refresh(context)).status).toBe(401);

      const loginResponse = await login();
      expect(loginResponse.status).toBe(httpStatus);
      expect(
        ((await loginResponse.json()) as { error: unknown }).error,
      ).toMatchObject(error);

      // A wrong password still reads as a wrong password.
      expect((await login("WrongPassword1!")).status).toBe(401);

      const blocked = await persistenceApp.prisma.authAuditEvent.findMany({
        where: { eventType: "login.failed", outcome: "blocked" },
      });
      expect(blocked).toEqual([
        expect.objectContaining({
          reasonCode,
          userId: context.userId,
          method: "password",
        }),
      ]);
    },
  );
});
