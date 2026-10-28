import { buildApiPath } from "@/configuration/http/api-path";
import {
  CSRF_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_HEADER_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/features/auth/auth.cookies";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const ORIGIN = "http://localhost:3040";
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

/**
 * Security middleware behaviour against the real production stack.
 *
 * Rate limiting and idempotency are backed by the live Redis instance here
 * rather than an in-memory double, so these assert the behaviour that actually
 * ships.
 */
describe("Security middleware persistence integration", () => {
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

  function expectSecurityHeaders(response: Response): void {
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  }

  function readCookieValue(header: string, name: string): string {
    return header.match(new RegExp(`${name}=([^;]+)`))?.[1] ?? "";
  }

  async function signIn(username: string, password: string) {
    const response = await request("/auth/local/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "user-agent": BROWSER_USER_AGENT,
      },
      body: JSON.stringify({
        username,
        password,
        captchaToken: "captcha-ok-login",
      }),
    });

    const body = (await response.json()) as {
      data?: { accessToken?: string };
    };
    const setCookie = response.headers.get("set-cookie") ?? "";

    return {
      status: response.status,
      accessToken: body.data?.accessToken ?? "",
      refreshToken: readCookieValue(setCookie, REFRESH_TOKEN_COOKIE_NAME),
      csrfToken: readCookieValue(setCookie, CSRF_TOKEN_COOKIE_NAME),
    };
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

  it("rejects a cookie-backed refresh from an untrusted browser origin", async () => {
    const session = await signIn("renter-one", "Rentify123!");
    expect(session.status).toBe(200);

    const response = await request("/auth/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        "user-agent": BROWSER_USER_AGENT,
        cookie: `${REFRESH_TOKEN_COOKIE_NAME}=${session.refreshToken}; ${CSRF_TOKEN_COOKIE_NAME}=${session.csrfToken}`,
        [CSRF_TOKEN_HEADER_NAME]: session.csrfToken,
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(403);
    expectSecurityHeaders(response);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("sends the security headers on a CORS preflight", async () => {
    const response = await request("/auth/local/login", {
      method: "OPTIONS",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expectSecurityHeaders(response);
  });

  it("accepts a cookie-backed refresh from a trusted origin", async () => {
    const session = await signIn("renter-one", "Rentify123!");

    const response = await request("/auth/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "user-agent": BROWSER_USER_AGENT,
        cookie: `${REFRESH_TOKEN_COOKIE_NAME}=${session.refreshToken}; ${CSRF_TOKEN_COOKIE_NAME}=${session.csrfToken}`,
        [CSRF_TOKEN_HEADER_NAME]: session.csrfToken,
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
  });

  it("rejects a request carrying two disagreeing idempotency keys", async () => {
    const response = await request("/auth/local/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "user-agent": BROWSER_USER_AGENT,
        "idempotency-key": "login-req-1",
        "x-idempotency-key": "login-req-2",
      },
      body: JSON.stringify({
        username: "renter-one",
        password: "Rentify123!",
        captchaToken: "captcha-ok-login",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "BAD_REQUEST" },
    });
  });

  it("rate limits repeated sign-in attempts from one client", async () => {
    const statuses: number[] = [];
    let limited: Response | undefined;

    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await request("/auth/local/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "user-agent": BROWSER_USER_AGENT,
          "x-forwarded-for": "198.51.100.77",
        },
        body: JSON.stringify({
          username: "rate-limited-user",
          password: "WrongPassword1!",
          captchaToken: "captcha-ok-login",
        }),
      });

      statuses.push(response.status);
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(statuses).toContain(429);
    expectSecurityHeaders(limited!);
  }, 180_000);

  it("rejects an invalid bearer token on a protected route", async () => {
    const response = await request("/profile/me", {
      headers: { authorization: "Bearer not-a-real-token" },
    });

    expect(response.status).toBe(401);
  });

  it("allows a personal access token on an allowlisted read but not on a write", async () => {
    const user = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    const createResponse = await request("/auth/personal-access-tokens", {
      method: "POST",
      headers: user.headers(),
      body: JSON.stringify({
        name: "Security Suite",
        scopes: ["mcp:read", "mcp:write"],
        expiresInDays: 30,
      }),
    });
    expect(createResponse.status).toBe(201);

    const created = (await createResponse.json()) as {
      data: { token: string };
    };
    const patHeaders = {
      authorization: `Bearer ${created.data.token}`,
      "content-type": "application/json",
      origin: ORIGIN,
    };

    const readResponse = await request("/profile/me", { headers: patHeaders });
    expect(readResponse.status).toBe(200);

    // Writes are not on the personal-access-token allowlist.
    const writeResponse = await request("/profile/me", {
      method: "PUT",
      headers: patHeaders,
      body: JSON.stringify({ username: "pat-should-not-write" }),
    });
    expect(writeResponse.status).toBe(403);

    expect(
      await persistenceApp.prisma.profile.findUniqueOrThrow({
        where: { userId: user.userId },
      }),
    ).toMatchObject({ username: "renter-one" });
  });

  it("rejects a non-admin on admin-only search operations", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const response = await request("/admin/search/status", {
      headers: owner.headers(),
    });

    expect(response.status).toBe(403);
  });
});
