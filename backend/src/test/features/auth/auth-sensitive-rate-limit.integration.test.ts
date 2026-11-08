import { buildApiPath } from "@/configuration/http/api-path";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const ORIGIN = "http://localhost:3040";
// The auth-sensitive policy allows 10 requests a minute per identity.
const AUTH_SENSITIVE_LIMIT = 10;

/**
 * Routes that left the default 60/min limit for the auth-sensitive one. Each
 * burst sends a body the route rejects, so the limit is reached without a
 * password changing or an account being created along the way.
 */
describe("auth-sensitive rate limit", () => {
  let persistenceApp: PersistenceTestApp;

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

  async function burst(send: () => Promise<Response>) {
    const statuses: number[] = [];
    let limited: Response | undefined;

    for (let attempt = 1; attempt <= AUTH_SENSITIVE_LIMIT + 1; attempt++) {
      const response = await send();
      statuses.push(response.status);

      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    return { statuses, limited };
  }

  it("limits password change for a signed-in user", async () => {
    const user = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    // An empty body fails validation, so no attempt reaches the password
    // check and none counts towards the lockout.
    const { statuses, limited } = await burst(() =>
      persistenceApp.app.request(
        `http://rent.test${buildApiPath("/auth/local/password/change")}`,
        {
          method: "POST",
          headers: { ...user.headers(), origin: ORIGIN },
          body: JSON.stringify({}),
        },
      ),
    );

    expect(statuses).toHaveLength(AUTH_SENSITIVE_LIMIT + 1);
    expect(statuses.slice(0, AUTH_SENSITIVE_LIMIT)).not.toContain(429);
    expect(limited?.headers.get("x-ratelimit-policy")).toBe("auth-sensitive");
    await expect(limited?.json()).resolves.toMatchObject({
      success: false,
      error: { code: "TOO_MANY_REQUESTS" },
    });

    const audited = await persistenceApp.prisma.authAuditEvent.findMany({
      where: { eventType: "rate_limit.exceeded", userId: user.userId },
    });
    expect(audited).toHaveLength(1);
  }, 120_000);

  it("limits OAuth signup completion for an anonymous caller", async () => {
    // An unknown continuation token answers 410, so nothing is created.
    const { statuses, limited } = await burst(() =>
      persistenceApp.app.request(
        `http://rent.test${buildApiPath("/auth/oauth/signup/complete")}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN },
          body: JSON.stringify({
            signupToken: "expired-or-invalid-token",
            dateOfBirth: "2012-06-15",
            captchaToken: "captcha-ok-oauth-signup",
          }),
        },
      ),
    );

    expect(statuses).toHaveLength(AUTH_SENSITIVE_LIMIT + 1);
    expect(statuses.slice(0, AUTH_SENSITIVE_LIMIT)).toEqual(
      Array(AUTH_SENSITIVE_LIMIT).fill(410),
    );
    expect(limited?.headers.get("x-ratelimit-policy")).toBe("auth-sensitive");
  }, 120_000);
});
