import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { getRedisClient } from "@/configuration/resources/redis";
import type { EmailJobPayload } from "@/features/email/email.model";
import {
  CSRF_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_HEADER_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/features/auth/auth.cookies";
import type { OtpService } from "@/features/auth/otp/otp.service";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { waitForRabbitMqPayload } from "../../support/live-rabbitmq-assertions";

const EMAIL_QUEUE_NAME = "email.delivery.main";

function readCookieValue(setCookieHeader: string, name: string): string | null {
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1] ?? null;
}

describe("Auth persistence integration", () => {
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

  it("persists signup verification into a real user record", async () => {
    const email = "new-user@rentify.local";

    const signupResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/signup")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3040",
        },
        body: JSON.stringify({
          email,
          username: "new-user",
          password: "StrongPassword1!",
          firstName: "New",
          lastName: "User",
          captchaToken: "captcha-ok-signup",
        }),
      },
    );

    expect(signupResponse.status).toBe(202);
    expect(
      await persistenceApp.prisma.user.findUnique({
        where: {
          email,
        },
      }),
    ).toBeNull();

    const verificationEmail = await waitForRabbitMqPayload<EmailJobPayload>(
      persistenceApp.infra.rabbitMq,
      EMAIL_QUEUE_NAME,
      (payload) =>
        payload.kind === "verification" && payload.input.to === email,
    );
    expect(verificationEmail).toMatchObject({
      kind: "verification",
      input: {
        to: email,
      },
      attempt: 0,
    });

    const otpService = persistenceApp.container.resolve<OtpService>(
      containerTokens.otpService,
    );
    const verificationCode = await otpService.peek({
      purpose: "email-verification",
      subject: email,
    });

    expect(verificationCode?.code).toBeTruthy();
    expect((verificationEmail.input as any).verificationCode).toBe(
      verificationCode?.code,
    );

    const verifyResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/email/verify")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3040",
        },
        body: JSON.stringify({
          email,
          code: verificationCode?.code,
          deviceId: "verify-device",
        }),
      },
    );

    expect(verifyResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.user.findUniqueOrThrow({
        where: {
          email,
        },
        include: {
          profile: true,
        },
      }),
    ).toMatchObject({
      email,
      emailVerified: true,
      role: "user",
      profile: expect.objectContaining({
        username: "new-user",
      }),
    });
  });

  it("creates and revokes real auth sessions through login and logout", async () => {
    const loginResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3040",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
        body: JSON.stringify({
          username: "renter-one",
          password: "Rentify123!",
          captchaToken: "captcha-ok-login",
          rememberMe: true,
        }),
      },
    );

    expect(loginResponse.status).toBe(200);
    expect(
      await getRedisClient().scan("0", { MATCH: "auth:session:*", COUNT: 100 }),
    ).toBeTruthy();

    const loginPayload = (await loginResponse.json()) as {
      data: {
        accessToken: string;
      };
    };
    const setCookieHeader = loginResponse.headers.get("set-cookie") ?? "";
    const refreshToken = readCookieValue(
      setCookieHeader,
      REFRESH_TOKEN_COOKIE_NAME,
    );
    const csrfToken = readCookieValue(setCookieHeader, CSRF_TOKEN_COOKIE_NAME);

    expect(refreshToken).toBeTruthy();
    expect(csrfToken).toBeTruthy();

    const logoutResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/logout")}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${loginPayload.data.accessToken}`,
          cookie: `${REFRESH_TOKEN_COOKIE_NAME}=${refreshToken}; ${CSRF_TOKEN_COOKIE_NAME}=${csrfToken}`,
          origin: "http://localhost:3040",
          [CSRF_TOKEN_HEADER_NAME]: csrfToken as string,
        },
      },
    );

    expect(logoutResponse.status).toBe(200);
    const sessionKeys = await getRedisClient().keys("auth:session:*");
    expect(sessionKeys).toHaveLength(1);
    const sessionRecord = await getRedisClient().get(sessionKeys[0]!);
    expect(sessionRecord).toContain('"status":"revoked"');
  });

  it("persists password changes and personal access token lifecycle changes", async () => {
    const user = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const beforeUser = await persistenceApp.prisma.user.findUniqueOrThrow({
      where: {
        id: user.userId,
      },
    });

    const changePasswordResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/password/change")}`,
      {
        method: "POST",
        headers: {
          ...user.headers(),
          origin: "http://localhost:3040",
        },
        body: JSON.stringify({
          currentPassword: "Rentify123!",
          newPassword: "NewPassword1!",
        }),
      },
    );

    expect(changePasswordResponse.status).toBe(200);
    const afterPasswordUser =
      await persistenceApp.prisma.user.findUniqueOrThrow({
        where: {
          id: user.userId,
        },
      });
    expect(afterPasswordUser.tokenVersion).toBeGreaterThan(
      beforeUser.tokenVersion,
    );
    expect(afterPasswordUser.passwordHash).not.toBe(beforeUser.passwordHash);

    const refreshedUser = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    const createPatResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/personal-access-tokens")}`,
      {
        method: "POST",
        headers: {
          ...refreshedUser.headers(),
          "content-type": "application/json",
          origin: "http://localhost:3040",
        },
        body: JSON.stringify({
          name: "Rentify MCP",
          scopes: ["mcp:read", "mcp:write"],
          expiresInDays: 30,
        }),
      },
    );

    expect(createPatResponse.status).toBe(201);
    const createdPat =
      await persistenceApp.prisma.personalAccessToken.findFirstOrThrow({
        where: {
          userId: user.userId,
          name: "Rentify MCP",
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    const revokePatResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/auth/personal-access-tokens/${createdPat.id}`)}`,
      {
        method: "DELETE",
        headers: refreshedUser.headers(),
      },
    );

    expect(revokePatResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.personalAccessToken.findUniqueOrThrow({
        where: {
          id: createdPat.id,
        },
      }),
    ).toMatchObject({
      revokedAt: expect.any(Date),
    });
  });
});
