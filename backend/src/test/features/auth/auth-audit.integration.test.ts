import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { getRedisClient } from "@/configuration/resources/redis";
import {
  CSRF_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_HEADER_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/features/auth/auth.cookies";
import { AuthAuditRepository } from "@/features/auth/audit/auth-audit.repository";
import { hashAuthIdentifier } from "@/features/auth/audit/auth-audit-identifier";
import { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import type { OtpService } from "@/features/auth/otp/otp.service";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const ORIGIN = "http://localhost:3040";
const PASSWORD = "Rentify123!";
const WRONG_PASSWORD = "WrongPassword1!";
// owner-one, unlike renter-one, is not on the harness's MFA bypass list.
const USERNAME = "owner-one";
const EMAIL = "owner1@rentify.local";

function readCookieValue(setCookieHeader: string, name: string): string | null {
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1] ?? null;
}

interface LoginResult {
  status: number;
  requestId: string | null;
  accessToken: string;
  refreshToken: string | null;
  csrfToken: string | null;
}

describe("Auth audit events persistence integration", () => {
  let persistenceApp: PersistenceTestApp;

  async function login(input: {
    username: string;
    password: string;
  }): Promise<LoginResult> {
    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "x-device-id": "audit-test-device",
        },
        body: JSON.stringify({
          username: input.username,
          password: input.password,
          captchaToken: "captcha-ok-login",
        }),
      },
    );
    const body = (await response.json()) as {
      data?: { accessToken?: string };
    };
    const setCookieHeader = response.headers.get("set-cookie") ?? "";

    return {
      status: response.status,
      requestId: response.headers.get("x-request-id"),
      accessToken: body.data?.accessToken ?? "",
      refreshToken: readCookieValue(setCookieHeader, REFRESH_TOKEN_COOKIE_NAME),
      csrfToken: readCookieValue(setCookieHeader, CSRF_TOKEN_COOKIE_NAME),
    };
  }

  async function logout(session: LoginResult): Promise<number> {
    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/logout")}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          cookie: `${REFRESH_TOKEN_COOKIE_NAME}=${session.refreshToken}; ${CSRF_TOKEN_COOKIE_NAME}=${session.csrfToken}`,
          origin: ORIGIN,
          [CSRF_TOKEN_HEADER_NAME]: session.csrfToken ?? "",
        },
      },
    );

    return response.status;
  }

  function sessionHeaders(session: LoginResult): Record<string, string> {
    return {
      authorization: `Bearer ${session.accessToken}`,
      "content-type": "application/json",
      cookie: `${REFRESH_TOKEN_COOKIE_NAME}=${session.refreshToken}; ${CSRF_TOKEN_COOKIE_NAME}=${session.csrfToken}`,
      origin: ORIGIN,
      [CSRF_TOKEN_HEADER_NAME]: session.csrfToken ?? "",
    };
  }

  async function postPublic(path: string, body: unknown): Promise<number> {
    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify(body),
      },
    );

    return response.status;
  }

  function listEvents() {
    return persistenceApp.prisma.authAuditEvent.findMany({
      orderBy: { createdAt: "asc" },
    });
  }

  function hash(value: string): string {
    return hashAuthIdentifier(value, process.env.AUTH_AUDIT_IDENTIFIER_SECRET!);
  }

  async function findUserId(): Promise<string> {
    const user = await persistenceApp.prisma.user.findUniqueOrThrow({
      where: { email: EMAIL },
    });
    return user.id;
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("records a sign-in, a failed attempt and a sign-out with their context", async () => {
    const userId = await findUserId();

    const session = await login({ username: USERNAME, password: PASSWORD });
    expect(session.status).toBe(200);
    const failed = await login({
      username: USERNAME,
      password: WRONG_PASSWORD,
    });
    expect(failed.status).toBe(401);
    expect(await logout(session)).toBe(200);

    const events = await listEvents();
    expect(events.map((event) => event.eventType)).toEqual([
      "device.new_detected",
      "login.succeeded",
      "login.failed",
      "logout",
    ]);

    const [newDevice, succeeded, failure, loggedOut] = events;
    expect(newDevice).toMatchObject({
      userId,
      outcome: "success",
      metadata: { emailNotification: "sent" },
    });
    expect(succeeded).toMatchObject({
      userId,
      outcome: "success",
      reasonCode: null,
      method: "password",
      identifierHash: hash(USERNAME),
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      deviceId: "audit-test-device",
      requestId: session.requestId,
      actorUserId: null,
    });
    expect(succeeded!.ipAddress).toMatch(/127\.0\.0\.1|::1/);
    expect(succeeded!.sessionId).toEqual(expect.any(String));
    expect(failure).toMatchObject({
      userId,
      outcome: "failure",
      reasonCode: "bad_credentials",
      identifierHash: hash(USERNAME),
      requestId: failed.requestId,
    });
    // The sign-out names the session the sign-in opened.
    expect(loggedOut).toMatchObject({
      userId,
      outcome: "success",
      sessionId: succeeded!.sessionId,
    });

    const user = await persistenceApp.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(user.lastLoginAt).toBeInstanceOf(Date);
  });

  it("records an unknown username by its hash alone", async () => {
    expect(
      (await login({ username: "nobody-here", password: WRONG_PASSWORD }))
        .status,
    ).toBe(401);

    const [event, ...rest] = await listEvents();
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({
      eventType: "login.failed",
      outcome: "failure",
      reasonCode: "bad_credentials",
      userId: null,
      identifierHash: hash("nobody-here"),
    });
  });

  it("records the MFA challenge as its own event", async () => {
    jest.spyOn(MfaTotpService.prototype, "isEnabled").mockResolvedValue(true);

    expect(
      (await login({ username: USERNAME, password: PASSWORD })).status,
    ).toBe(401);

    const events = await listEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "login.mfa_challenged",
      outcome: "success",
      reasonCode: "mfa_required",
      userId: await findUserId(),
    });
  });

  it("records the lock, the attempts against it, and the unlock", async () => {
    const userId = await findUserId();

    for (let attempt = 0; attempt < 5; attempt++) {
      await login({ username: USERNAME, password: WRONG_PASSWORD });
    }
    expect(
      (await login({ username: USERNAME, password: PASSWORD })).status,
    ).toBe(423);
    expect(
      await postPublic("/auth/local/unlock/resend", {
        email: EMAIL,
        captchaToken: "captcha-ok-unlock",
      }),
    ).toBe(202);
    const otpService = persistenceApp.container.resolve<OtpService>(
      containerTokens.otpService,
    );
    const otp = await otpService.peek({
      purpose: "local-login-unlock",
      subject: EMAIL,
    });
    expect(
      await postPublic("/auth/local/unlock", {
        email: EMAIL,
        code: "000001",
        captchaToken: "captcha-ok-unlock",
      }),
    ).toBe(400);
    expect(
      await postPublic("/auth/local/unlock", {
        email: EMAIL,
        code: otp!.code,
        captchaToken: "captcha-ok-unlock",
      }),
    ).toBe(200);

    const events = await listEvents();
    expect(
      events.map((event) => [event.eventType, event.outcome, event.reasonCode]),
    ).toEqual([
      ["login.failed", "failure", "bad_credentials"],
      ["login.failed", "failure", "bad_credentials"],
      ["login.failed", "failure", "bad_credentials"],
      ["login.failed", "failure", "bad_credentials"],
      ["login.locked", "blocked", "locked"],
      ["login.locked", "blocked", "locked"],
      ["login.unlock_requested", "success", null],
      ["login.unlocked", "failure", "otp_invalid"],
      ["login.unlocked", "success", null],
    ]);
    expect(events[4]!.metadata).toEqual({
      triggered: true,
      failureReason: "bad_credentials",
    });
    expect(events[5]!.metadata).toBeNull();
    expect(events.every((event) => event.userId === userId)).toBe(true);
    // The unlock routes are keyed by email, so they hash the email.
    expect(events.slice(6).map((event) => event.identifierHash)).toEqual([
      hash(EMAIL),
      hash(EMAIL),
      hash(EMAIL),
    ]);

    // Nothing the caller typed in secret, and no unknown identifier, is stored.
    const stored = JSON.stringify(events);
    for (const secret of [PASSWORD, WRONG_PASSWORD, otp!.code, USERNAME]) {
      expect(stored).not.toContain(secret);
    }
  }, 120_000);

  it("signs in normally when the audit insert fails", async () => {
    const create = jest
      .spyOn(AuthAuditRepository.prototype, "create")
      .mockRejectedValue(new Error("simulated audit store outage"));

    const session = await login({ username: USERNAME, password: PASSWORD });

    expect(session.status).toBe(200);
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "login.succeeded" }),
    );
    expect(await listEvents()).toHaveLength(0);
  });

  it("persists OAuth signup and returning-login events from the mocked verifier", async () => {
    const authenticate = () =>
      persistenceApp.app.request(
        `http://rent.test${buildApiPath("/auth/oauth/google")}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN },
          body: JSON.stringify({
            idToken: "google-id-token",
            nonce: "audit-oauth-nonce",
            deviceId: "audit-oauth-device",
            dateOfBirth: "2012-06-15",
          }),
        },
      );

    expect((await authenticate()).status).toBe(200);
    expect((await authenticate()).status).toBe(200);

    const events = (await listEvents()).filter((event) =>
      event.eventType.startsWith("oauth."),
    );
    expect(events.map((event) => event.eventType)).toEqual([
      "oauth.signup.completed",
      "oauth.login.succeeded",
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: "success",
          method: "google",
          identifierHash: hash("google-user@rentify.local"),
          userId: expect.any(String),
          sessionId: expect.any(String),
        }),
      ]),
    );
  });

  it("revokes and audits a session when a refresh token is replayed outside grace", async () => {
    const session = await login({ username: USERNAME, password: PASSWORD });
    expect(session.status).toBe(200);

    const firstRefresh = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/refresh")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      },
    );
    expect(firstRefresh.status).toBe(200);

    const [, encodedClaims] = session.refreshToken!.split(".");
    const claims = JSON.parse(
      Buffer.from(encodedClaims!, "base64url").toString("utf8"),
    ) as { jti: string };
    const redis = getRedisClient();
    const refreshKey = `auth:refresh:${claims.jti}`;
    const refreshRecord = JSON.parse((await redis.get(refreshKey))!) as {
      rotatedAt: number;
      [key: string]: unknown;
    };
    const ttl = await redis.ttl(refreshKey);
    await redis.set(
      refreshKey,
      JSON.stringify({
        ...refreshRecord,
        rotatedAt: refreshRecord.rotatedAt - 6,
      }),
      { EX: ttl },
    );

    const replay = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/refresh")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      },
    );
    expect(replay.status).toBe(401);

    const reuse = (await listEvents()).find(
      (event) => event.eventType === "session.refresh_reuse_detected",
    );
    expect(reuse).toMatchObject({
      outcome: "blocked",
      method: "refresh",
      userId: await findUserId(),
      sessionId: expect.any(String),
    });
  });

  it("persists password, PAT, and per-session device revocation events without secrets", async () => {
    const initial = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const changedPassword = "AuditChangedPassword1!";
    const passwordResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/password/change")}`,
      {
        method: "POST",
        headers: initial.headers({ origin: ORIGIN }),
        body: JSON.stringify({
          currentPassword: PASSWORD,
          newPassword: changedPassword,
        }),
      },
    );
    expect(passwordResponse.status).toBe(200);

    const current = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const createPatResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/personal-access-tokens")}`,
      {
        method: "POST",
        headers: current.headers({ origin: ORIGIN }),
        body: JSON.stringify({
          name: "Audit PAT",
          scopes: ["mcp:read"],
          expiresInDays: 30,
        }),
      },
    );
    expect(createPatResponse.status).toBe(201);
    const patBody = (await createPatResponse.json()) as {
      data: { id: string; token: string };
    };
    const revokePatResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/auth/personal-access-tokens/${patBody.data.id}`)}`,
      { method: "DELETE", headers: current.headers({ origin: ORIGIN }) },
    );
    expect(revokePatResponse.status).toBe(200);

    const removeDeviceResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/devices/remove")}`,
      {
        method: "DELETE",
        headers: current.headers({ origin: ORIGIN }),
        body: JSON.stringify({ deviceId: current.deviceId }),
      },
    );
    expect(removeDeviceResponse.status).toBe(200);

    const relevant = (await listEvents()).filter((event) =>
      [
        "password.changed",
        "pat.created",
        "pat.revoked",
        "session.revoked",
      ].includes(event.eventType),
    );
    expect(relevant.slice(0, 3).map((event) => event.eventType)).toEqual([
      "password.changed",
      "pat.created",
      "pat.revoked",
    ]);
    expect(relevant[1]!.metadata).toEqual({ tokenId: patBody.data.id });
    expect(relevant[2]!.metadata).toEqual({ tokenId: patBody.data.id });
    expect(
      relevant.find(
        (event) =>
          event.eventType === "session.revoked" &&
          event.sessionId === current.sessionId,
      ),
    ).toMatchObject({
      userId: current.userId,
      sessionId: current.sessionId,
      deviceId: current.deviceId,
      actorUserId: null,
    });
    const serialized = JSON.stringify(relevant);
    expect(serialized).not.toContain(changedPassword);
    expect(serialized).not.toContain(patBody.data.token);
  }, 120_000);

  it("dedupes a 50-request login 429 burst to one persisted event", async () => {
    const responses = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      responses.push(
        await login({ username: "rate-limit-audit", password: WRONG_PASSWORD }),
      );
    }

    expect(
      responses.filter((response) => response.status === 429),
    ).toHaveLength(40);
    const events = (await listEvents()).filter(
      (event) => event.eventType === "rate_limit.exceeded",
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: "blocked",
      reasonCode: "rate_limited",
      userId: null,
      metadata: { policy: "auth-sensitive", identityType: "ip" },
    });
  }, 120_000);
});
