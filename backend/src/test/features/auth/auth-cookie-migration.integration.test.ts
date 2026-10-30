import { buildApiPath } from "@/configuration/http/api-path";
import {
  CSRF_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_HEADER_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  SECURE_CSRF_TOKEN_COOKIE_NAME,
  SECURE_REFRESH_TOKEN_COOKIE_NAME,
} from "@/features/auth/auth.cookies";
import {
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const ORIGIN = "http://localhost:3040";
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const ORIGINAL_AUTH_COOKIE_SECURE = process.env.AUTH_COOKIE_SECURE;

/**
 * Session cookies moved to `__Host-` names. A browser still holding the old
 * `refresh_token` / `csrf_token` pair must stay signed in, and be moved onto
 * the new names by its next refresh.
 */
describe("Session cookie rename persistence integration", () => {
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

  function browserHeaders(extra: Record<string, string> = {}) {
    return {
      "content-type": "application/json",
      origin: ORIGIN,
      "user-agent": BROWSER_USER_AGENT,
      ...extra,
    };
  }

  function findSetCookie(response: Response, name: string): string | undefined {
    return response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith(`${name}=`));
  }

  function readSetCookieValue(
    response: Response,
    name: string,
  ): string | undefined {
    return findSetCookie(response, name)
      ?.split(";")[0]
      .slice(name.length + 1);
  }

  async function signIn() {
    const response = await request("/auth/local/login", {
      method: "POST",
      headers: browserHeaders(),
      body: JSON.stringify({
        username: "renter-one",
        password: "Rentify123!",
        captchaToken: "captcha-ok-login",
      }),
    });
    expect(response.status).toBe(200);

    return {
      refreshToken: readSetCookieValue(
        response,
        SECURE_REFRESH_TOKEN_COOKIE_NAME,
      )!,
      csrfToken: readSetCookieValue(response, SECURE_CSRF_TOKEN_COOKIE_NAME)!,
    };
  }

  async function refresh(
    refreshCookie: string,
    csrfCookie: string,
    tokens: { refreshToken: string; csrfToken: string },
  ): Promise<Response> {
    return request("/auth/refresh", {
      method: "POST",
      headers: browserHeaders({
        cookie: `${refreshCookie}=${tokens.refreshToken}; ${csrfCookie}=${tokens.csrfToken}`,
        [CSRF_TOKEN_HEADER_NAME]: tokens.csrfToken,
      }),
      body: JSON.stringify({}),
    });
  }

  beforeAll(async () => {
    process.env.AUTH_COOKIE_SECURE = "true";
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();

    if (ORIGINAL_AUTH_COOKIE_SECURE === undefined) {
      delete process.env.AUTH_COOKIE_SECURE;
    } else {
      process.env.AUTH_COOKIE_SECURE = ORIGINAL_AUTH_COOKIE_SECURE;
    }
  }, 180_000);

  it("signs in with Secure __Host- cookies only", async () => {
    const response = await request("/auth/local/login", {
      method: "POST",
      headers: browserHeaders(),
      body: JSON.stringify({
        username: "renter-one",
        password: "Rentify123!",
        captchaToken: "captcha-ok-login",
      }),
    });

    const refreshCookie = findSetCookie(
      response,
      SECURE_REFRESH_TOKEN_COOKIE_NAME,
    );
    const csrfCookie = findSetCookie(response, SECURE_CSRF_TOKEN_COOKIE_NAME);
    expect(refreshCookie).toMatch(
      /; Path=\/;.*; HttpOnly; Secure; SameSite=Lax$/,
    );
    expect(csrfCookie).toMatch(/; Path=\/;.*; Secure; SameSite=Lax$/);
    expect(csrfCookie).not.toContain("HttpOnly");
    for (const cookie of response.headers.getSetCookie()) {
      expect(cookie).not.toContain("Domain=");
    }
    expect(readSetCookieValue(response, REFRESH_TOKEN_COOKIE_NAME)).toBe("");
  });

  it("keeps a session issued under the legacy names and moves it to the __Host- names", async () => {
    const session = await signIn();

    const migrated = await refresh(
      REFRESH_TOKEN_COOKIE_NAME,
      CSRF_TOKEN_COOKIE_NAME,
      session,
    );

    expect(migrated.status).toBe(200);
    const rotated = {
      refreshToken: readSetCookieValue(
        migrated,
        SECURE_REFRESH_TOKEN_COOKIE_NAME,
      )!,
      csrfToken: readSetCookieValue(migrated, SECURE_CSRF_TOKEN_COOKIE_NAME)!,
    };
    expect(rotated.refreshToken).toBeTruthy();
    expect(rotated.refreshToken).not.toBe(session.refreshToken);
    expect(rotated.csrfToken).toBeTruthy();
    expect(readSetCookieValue(migrated, REFRESH_TOKEN_COOKIE_NAME)).toBe("");
    expect(readSetCookieValue(migrated, CSRF_TOKEN_COOKIE_NAME)).toBe("");

    const next = await refresh(
      SECURE_REFRESH_TOKEN_COOKIE_NAME,
      SECURE_CSRF_TOKEN_COOKIE_NAME,
      rotated,
    );

    expect(next.status).toBe(200);
  });

  it("rejects a legacy CSRF cookie paired with a __Host- refresh cookie", async () => {
    const session = await signIn();

    const response = await refresh(
      SECURE_REFRESH_TOKEN_COOKIE_NAME,
      CSRF_TOKEN_COOKIE_NAME,
      session,
    );

    expect(response.status).toBe(403);
  });

  it("clears both the __Host- and the legacy cookies on logout", async () => {
    const login = await request("/auth/local/login", {
      method: "POST",
      headers: browserHeaders(),
      body: JSON.stringify({
        username: "renter-one",
        password: "Rentify123!",
        captchaToken: "captcha-ok-login",
      }),
    });
    const accessToken = (
      (await login.json()) as { data: { accessToken: string } }
    ).data.accessToken;
    const refreshToken = readSetCookieValue(
      login,
      SECURE_REFRESH_TOKEN_COOKIE_NAME,
    )!;
    const csrfToken = readSetCookieValue(login, SECURE_CSRF_TOKEN_COOKIE_NAME)!;

    const response = await request("/auth/logout", {
      method: "POST",
      headers: browserHeaders({
        authorization: `Bearer ${accessToken}`,
        cookie: `${SECURE_REFRESH_TOKEN_COOKIE_NAME}=${refreshToken}; ${SECURE_CSRF_TOKEN_COOKIE_NAME}=${csrfToken}`,
        [CSRF_TOKEN_HEADER_NAME]: csrfToken,
      }),
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    for (const name of [
      SECURE_REFRESH_TOKEN_COOKIE_NAME,
      SECURE_CSRF_TOKEN_COOKIE_NAME,
      REFRESH_TOKEN_COOKIE_NAME,
      CSRF_TOKEN_COOKIE_NAME,
    ]) {
      expect(readSetCookieValue(response, name)).toBe("");
    }

    const reused = await refresh(
      SECURE_REFRESH_TOKEN_COOKIE_NAME,
      SECURE_CSRF_TOKEN_COOKIE_NAME,
      { refreshToken, csrfToken },
    );
    expect(reused.status).toBe(401);
  });
});
