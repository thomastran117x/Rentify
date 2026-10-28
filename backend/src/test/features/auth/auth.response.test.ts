import { environment } from "@/configuration/environment";
import type { AuthSessionResult } from "@/features/auth/auth.model";
import {
  clearBrowserSessionCookies,
  createCsrfToken,
  isBrowserRequest,
  setBrowserSessionCookies,
  toAuthResponseBody,
  writeAuthSessionResponse,
} from "@/features/auth/auth.response";
import { createMockRequest, createMockResponse } from "../../support/mock-http";
import { testUuid } from "../../support/uuid";

const USER_1_ID = testUuid(9000, 994257);

function createSessionResult(
  overrides: Partial<AuthSessionResult> = {},
): AuthSessionResult {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    refreshTokenExpiresInSeconds: 3600,
    device: { deviceId: "device-1", known: true, knownByIp: false },
    user: {
      avatarVariants: null,
      id: USER_1_ID,
      email: "user@example.com",
      username: "test-user",
      avatarUrl: undefined,
      isPrivate: false,
      recommendationPersonalizationEnabled: true,
      trustworthinessScore: 80,
      rentPostingsCount: 0,
      availableRentPostingsCount: 0,
      role: "user",
      emailVerified: true,
      organizationMembershipCount: 0,
    },
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isBrowserRequest", () => {
  it.each(["origin", "referer", "sec-fetch-site"])(
    "treats a request carrying %s as a browser",
    (header) => {
      expect(
        isBrowserRequest(
          createMockRequest({ headers: { [header]: "https://rent.test" } }),
        ),
      ).toBe(true);
    },
  );

  it("treats a request with none of them as an API client", () => {
    expect(isBrowserRequest(createMockRequest())).toBe(false);
  });
});

describe("createCsrfToken", () => {
  it("returns a fresh token each call", () => {
    expect(createCsrfToken()).not.toBe(createCsrfToken());
  });
});

describe("toAuthResponseBody", () => {
  it("omits the refresh token for browser callers", () => {
    const body = toAuthResponseBody(
      createMockRequest({ headers: { origin: "https://rent.test" } }),
      createSessionResult(),
    );

    expect(body.refreshToken).toBeUndefined();
    expect(body.accessToken).toBe("access-token");
    expect(body.user).toEqual({
      id: USER_1_ID,
      email: "user@example.com",
      username: "test-user",
      avatarUrl: undefined,
      avatarVariants: null,
      role: "user",
      activeOrganization: undefined,
      organizationMembershipCount: 0,
    });
  });

  it("returns the refresh token in the body for API callers", () => {
    const body = toAuthResponseBody(createMockRequest(), createSessionResult());

    expect(body.refreshToken).toBe("refresh-token");
  });

  it("flags a first-time OAuth signup", () => {
    expect(
      toAuthResponseBody(
        createMockRequest(),
        createSessionResult({ isNewUser: true }),
      ).isNewUser,
    ).toBe(true);
  });

  it("omits the flag for a returning sign-in", () => {
    expect(
      toAuthResponseBody(createMockRequest(), createSessionResult()).isNewUser,
    ).toBeUndefined();
  });
});

describe("setBrowserSessionCookies", () => {
  it("writes an httpOnly refresh cookie and a readable csrf cookie", () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(false);
    const recorder = createMockResponse();

    setBrowserSessionCookies(recorder.response, createSessionResult());

    const header = recorder.headers()["set-cookie"];
    expect(header).toContain("refresh_token=refresh-token");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Max-Age=3600");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("csrf_token=");
    expect(header).not.toContain("Secure");
  });

  it("writes neither __Host- cookie when cookies are not secure", () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(false);
    const recorder = createMockResponse();

    setBrowserSessionCookies(recorder.response, createSessionResult());

    expect(recorder.headers()["set-cookie"]).not.toContain("__Host-");
  });

  it("writes the __Host- cookies in production and expires the legacy ones", () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(true);
    const recorder = createMockResponse();

    setBrowserSessionCookies(recorder.response, createSessionResult());

    const header = recorder.headers()["set-cookie"];
    expect(header).toMatch(
      /__Host-rentify_refresh=refresh-token; Max-Age=3600; Path=\/; HttpOnly; Secure; SameSite=Lax/,
    );
    expect(header).toMatch(
      /__Host-rentify_csrf=[^;]+; Max-Age=3600; Path=\/; Secure; SameSite=Lax/,
    );
    expect(header).not.toContain("Domain=");
    expect(header).toMatch(/(^|, )refresh_token=; Max-Age=0; Path=\/;/);
    expect(header).toMatch(/(^|, )csrf_token=; Max-Age=0; Path=\/;/);
  });
});

describe("clearBrowserSessionCookies", () => {
  it("expires both legacy session cookies when cookies are not secure", () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(false);
    const recorder = createMockResponse();

    clearBrowserSessionCookies(recorder.response);

    const header = recorder.headers()["set-cookie"];
    expect(header).toContain("refresh_token=");
    expect(header).toContain("csrf_token=");
    expect(header).toContain("HttpOnly");
    expect(header).not.toContain("__Host-");
  });

  it("expires the __Host- and the legacy cookies in production", () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(true);
    const recorder = createMockResponse();

    clearBrowserSessionCookies(recorder.response);

    const header = recorder.headers()["set-cookie"];
    for (const name of [
      "refresh_token",
      "csrf_token",
      "__Host-rentify_refresh",
      "__Host-rentify_csrf",
    ]) {
      expect(header).toMatch(new RegExp(`(^|, )${name}=; Max-Age=0; Path=/;`));
    }
  });
});

describe("writeAuthSessionResponse", () => {
  it("sets cookies and omits the refresh token for a browser caller", () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(false);
    const request = createMockRequest({
      headers: { origin: "https://rent.test" },
    });
    const recorder = createMockResponse();
    (recorder.response as { req?: unknown }).req = request;

    writeAuthSessionResponse(
      request,
      recorder.response,
      createSessionResult(),
      {
        message: "Authenticated successfully.",
      },
    );

    expect(recorder.status()).toBe(200);
    expect(recorder.json()).toMatchObject({
      message: "Authenticated successfully.",
      data: { accessToken: "access-token" },
    });
    expect(
      (recorder.json() as { data: Record<string, unknown> }).data.refreshToken,
    ).toBeUndefined();
    expect(recorder.headers()["set-cookie"]).toContain("refresh_token=");
  });

  it("returns the refresh token and sets no cookies for an API caller", () => {
    const request = createMockRequest();
    const recorder = createMockResponse();
    (recorder.response as { req?: unknown }).req = request;

    writeAuthSessionResponse(request, recorder.response, createSessionResult());

    expect(recorder.json()).toMatchObject({
      data: { refreshToken: "refresh-token" },
    });
    expect(recorder.headers()["set-cookie"]).toBeUndefined();
  });
});
