import { buildApiPath } from "@/configuration/http/api-path";
import {
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const ORIGIN = "http://localhost:3040";
const CLIENT_IP = "198.51.100.77";
// The auth-sensitive policy allows 10 attempts a minute per client address.
const AUTH_SENSITIVE_LIMIT = 10;

/**
 * Behind one trusted proxy, the client address is the entry that proxy
 * appended to X-Forwarded-For. Whatever the client itself put to the left of
 * it must not change which per-IP bucket the request lands in.
 */
describe("Client IP resolution behind a trusted proxy", () => {
  let persistenceApp: PersistenceTestApp;
  const originalHops = process.env.TRUSTED_PROXY_HOPS;

  function failedLogin(forwardedFor: string) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "x-forwarded-for": forwardedFor,
        },
        body: JSON.stringify({
          username: "spoofing-user",
          password: "WrongPassword1!",
          captchaToken: "captcha-ok-login",
        }),
      },
    );
  }

  beforeAll(async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
    await persistenceApp.prisma.authAuditEvent.deleteMany({});
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
    if (originalHops === undefined) {
      delete process.env.TRUSTED_PROXY_HOPS;
    } else {
      process.env.TRUSTED_PROXY_HOPS = originalHops;
    }
  }, 180_000);

  it("rate limits a client that rotates the left-most X-Forwarded-For entry", async () => {
    const statuses: number[] = [];
    let limited: Response | undefined;

    for (let attempt = 1; attempt <= AUTH_SENSITIVE_LIMIT + 1; attempt++) {
      const response = await failedLogin(`203.0.113.${attempt}, ${CLIENT_IP}`);
      statuses.push(response.status);

      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(statuses).toHaveLength(AUTH_SENSITIVE_LIMIT + 1);
    expect(statuses.slice(0, AUTH_SENSITIVE_LIMIT)).not.toContain(429);
    expect(limited?.headers.get("x-ratelimit-policy")).toBe("auth-sensitive");

    const failures = await persistenceApp.prisma.authAuditEvent.findMany({
      where: { eventType: "login.failed" },
      select: { ipAddress: true },
    });
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((event) => event.ipAddress === CLIENT_IP)).toBe(true);
  }, 180_000);

  it("keys the limit on the proxy-appended entry, not the left-most one", async () => {
    // Control: the same spoofed prefix from distinct real clients is not
    // pooled into one bucket.
    for (let attempt = 1; attempt <= AUTH_SENSITIVE_LIMIT + 1; attempt++) {
      const response = await failedLogin(
        `203.0.113.250, 198.51.100.${attempt}`,
      );

      expect(response.status).not.toBe(429);
    }
  }, 180_000);
});
