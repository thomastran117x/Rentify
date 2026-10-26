import { setTimeout as delay } from "node:timers/promises";
import { containerTokens } from "@/configuration/container/tokens";
import { buildApiPath } from "@/configuration/http/api-path";
import { getRedisClient } from "@/configuration/resources/redis";
import {
  CSRF_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_HEADER_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/features/auth/auth.cookies";
import { SuspiciousActivityDetector } from "@/features/auth/detection/suspicious-activity.detector";
import type { SuspiciousActivityDetectionConfig } from "@/features/auth/detection/suspicious-activity.model";
import type { EmailJobPayload } from "@/features/email/email.model";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { waitForRabbitMqPayload } from "../../support/live-rabbitmq-assertions";

const ORIGIN = "http://localhost:3040";
const PASSWORD = "Rentify123!";
const WRONG_PASSWORD = "WrongPassword1!";
const RENTER_ONE = { username: "renter-one", email: "user1@rentify.local" };
const RENTER_TWO = { username: "renter-two", email: "user2@rentify.local" };

function enforceConfig(): SuspiciousActivityDetectionConfig {
  return {
    mode: "enforce",
    repeatedLockouts: { enabled: true, threshold: 3, windowMinutes: 1440 },
    // Low enough to reach under the auth-sensitive limit of 10 a minute.
    credentialStuffing: {
      enabled: true,
      threshold: 5,
      windowMinutes: 10,
      blockMinutes: 60,
    },
    // Below the 5 failures that lock an account, so the sign-in that follows
    // still succeeds.
    successAfterFailures: { enabled: true, threshold: 3, windowMinutes: 60 },
    refreshReuse: { enabled: true, windowMinutes: 60 },
  };
}

function readCookieValue(setCookieHeader: string, name: string): string | null {
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1] ?? null;
}

/** Detection runs after the response, so its effects are polled for. */
async function waitFor<T>(
  read: () => Promise<T | null | undefined | false>,
  description: string,
  timeoutMs = 10_000,
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await read();

    if (value) {
      return value;
    }

    await delay(100);
  }

  throw new Error(`Timed out waiting for ${description}.`);
}

// Each scenario signs in many times, and every sign-in checks a bcrypt hash.
jest.setTimeout(60_000);

describe("Suspicious sign-in detection integration", () => {
  let persistenceApp: PersistenceTestApp;
  let config = enforceConfig();
  const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS;

  function request(path: string, init: RequestInit = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  function login(input: {
    username: string;
    password: string;
    ip: string;
    deviceId?: string;
  }) {
    return request("/auth/local/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "x-device-id": input.deviceId ?? "detection-test-device",
        "x-forwarded-for": input.ip,
      },
      body: JSON.stringify({
        username: input.username,
        password: input.password,
        captchaToken: "captcha-ok-login",
      }),
    });
  }

  function suspiciousEvents() {
    return persistenceApp.prisma.authAuditEvent.findMany({
      where: { eventType: "security.suspicious_activity" },
    });
  }

  function waitForSuspiciousEvent(rule: string) {
    return waitFor(
      async () =>
        (await suspiciousEvents()).find(
          (event) =>
            (event.metadata as { rule?: string } | null)?.rule === rule,
        ),
      `a ${rule} suspicious-activity event`,
    );
  }

  beforeAll(async () => {
    // Each scenario signs in from its own address.
    process.env.TRUST_PROXY_HEADERS = "true";
    persistenceApp = await createPersistenceTestApp({
      attachAuthAuditListeners: true,
      registerOverrides: (container) => {
        container.register({
          token: containerTokens.suspiciousActivityDetector,
          lifetime: "singleton",
          dependencies: [
            containerTokens.cacheService,
            containerTokens.authAuditRepository,
            containerTokens.accountStatusService,
            containerTokens.authUsersRepository,
            containerTokens.emailService,
            containerTokens.selfLockTokenStore,
            containerTokens.authIpBlockStore,
          ],
          resolve: ({ resolve }) =>
            new SuspiciousActivityDetector({
              cache: resolve(containerTokens.cacheService),
              repository: resolve(containerTokens.authAuditRepository),
              accountStatusService: resolve(
                containerTokens.accountStatusService,
              ),
              usersRepository: resolve(containerTokens.authUsersRepository),
              emailService: resolve(containerTokens.emailService),
              selfLockTokenStore: resolve(containerTokens.selfLockTokenStore),
              ipBlockStore: resolve(containerTokens.authIpBlockStore),
              getConfig: () => config,
            }),
        });
      },
    });
  }, 180_000);

  beforeEach(async () => {
    config = enforceConfig();
    await resetPersistenceState();
    await persistenceApp.prisma.authAuditEvent.deleteMany({});
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
    if (originalTrustProxyHeaders === undefined) {
      delete process.env.TRUST_PROXY_HEADERS;
    } else {
      process.env.TRUST_PROXY_HEADERS = originalTrustProxyHeaders;
    }
  }, 180_000);

  describe("rule (b): credential stuffing", () => {
    async function stuff(ip: string) {
      for (let index = 0; index < 5; index += 1) {
        const response = await login({
          username: `stuffing-target-${index}`,
          password: WRONG_PASSWORD,
          ip,
        });
        expect(response.status).toBe(401);
      }
    }

    it("flags the burst, then blocks the IP on auth-sensitive routes without locking any account", async () => {
      const ip = "198.51.100.41";

      await stuff(ip);
      const flaggedEvent = await waitForSuspiciousEvent("credential_stuffing");
      await waitFor(
        async () =>
          (await getRedisClient().exists(`auth:ip-block:${ip}`)) === 1,
        "the IP block",
      );

      expect(flaggedEvent).toMatchObject({
        userId: null,
        ipAddress: ip,
        outcome: "blocked",
        flagged: true,
        metadata: expect.objectContaining({
          mode: "enforce",
          action: "ip_blocked",
          count: 5,
          relatedEventCount: 5,
        }),
      });
      const failures = await persistenceApp.prisma.authAuditEvent.findMany({
        where: { eventType: "login.failed", ipAddress: ip },
      });
      expect(failures).toHaveLength(5);
      expect(failures.every((event) => event.flagged)).toBe(true);

      const blocked = await login({
        username: RENTER_ONE.username,
        password: PASSWORD,
        ip,
      });
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(3500);
      await expect(blocked.json()).resolves.toMatchObject({
        error: {
          code: "TOO_MANY_REQUESTS",
          details: { policy: "auth-sensitive", reason: "ip_blocked" },
        },
      });

      // Another address is unaffected, and no account was held.
      const elsewhere = await login({
        username: RENTER_ONE.username,
        password: PASSWORD,
        ip: "198.51.100.42",
      });
      expect(elsewhere.status).toBe(200);
      expect(
        await persistenceApp.prisma.authAuditEvent.count({
          where: { eventType: "account.locked" },
        }),
      ).toBe(0);
    });

    it("lets an admin see and lift the block, and no one else", async () => {
      const ip = "198.51.100.45";
      await stuff(ip);
      await waitFor(
        async () =>
          (await getRedisClient().exists(`auth:ip-block:${ip}`)) === 1,
        "the IP block",
      );
      const admin = await createAuthenticatedRequestContext({
        email: "admin1@rentify.local",
      });
      const renter = await createAuthenticatedRequestContext({
        email: RENTER_ONE.email,
      });

      const list = await request("/admin/auth/ip-blocks", {
        headers: admin.headers({ origin: ORIGIN }),
      });
      expect(list.status).toBe(200);
      await expect(list.json()).resolves.toMatchObject({
        data: { items: [{ ipAddress: ip, expiresAt: expect.any(String) }] },
      });

      expect(
        (
          await request("/admin/auth/ip-blocks", {
            headers: renter.headers({ origin: ORIGIN }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(`/admin/auth/ip-blocks/${ip}`, {
            method: "DELETE",
            headers: renter.headers({ origin: ORIGIN }),
          })
        ).status,
      ).toBe(403);

      const unblock = await request(`/admin/auth/ip-blocks/${ip}`, {
        method: "DELETE",
        headers: admin.headers({ origin: ORIGIN }),
      });
      expect(unblock.status).toBe(204);
      expect(
        (
          await request(`/admin/auth/ip-blocks/${ip}`, {
            method: "DELETE",
            headers: admin.headers({ origin: ORIGIN }),
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await request("/admin/auth/ip-blocks/not-an-ip", {
            method: "DELETE",
            headers: admin.headers({ origin: ORIGIN }),
          })
        ).status,
      ).toBe(400);

      const [unblocked] = await persistenceApp.prisma.authAuditEvent.findMany({
        where: { eventType: "admin.ip_unblocked" },
      });
      expect(unblocked).toMatchObject({
        actorUserId: admin.userId,
        metadata: { ipAddress: ip },
      });
      expect(
        (
          await login({
            username: RENTER_ONE.username,
            password: PASSWORD,
            ip,
          })
        ).status,
      ).toBe(200);
    });

    it("records and flags in alert mode but never blocks", async () => {
      config = { ...enforceConfig(), mode: "alert" };
      const ip = "198.51.100.43";

      await stuff(ip);
      const flaggedEvent = await waitForSuspiciousEvent("credential_stuffing");

      expect(flaggedEvent).toMatchObject({
        outcome: "failure",
        metadata: expect.objectContaining({ mode: "alert", action: "none" }),
      });
      expect(await getRedisClient().exists(`auth:ip-block:${ip}`)).toBe(0);
      expect(
        (
          await login({
            username: RENTER_ONE.username,
            password: PASSWORD,
            ip,
          })
        ).status,
      ).toBe(200);
    });

    it("does nothing in off mode", async () => {
      config = { ...enforceConfig(), mode: "off" };

      await stuff("198.51.100.44");
      await delay(500);

      expect(await suspiciousEvents()).toHaveLength(0);
      expect(
        await persistenceApp.prisma.authAuditEvent.count({
          where: { flagged: true },
        }),
      ).toBe(0);
    });
  });

  describe("rule (a): repeated lockouts", () => {
    it("puts the account on a security hold with source system and emails the user", async () => {
      // Three lockouts, each from its own address so the rate limit never
      // interferes. Clearing the attempt record stands in for its expiry.
      for (let round = 0; round < 3; round += 1) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const response = await login({
            username: RENTER_TWO.username,
            password: WRONG_PASSWORD,
            ip: `198.51.100.${60 + round}`,
          });
          expect(response.status).toBe(attempt < 4 ? 401 : 423);
        }
        await getRedisClient().del(
          `auth:local-login-attempts:${RENTER_TWO.username}`,
        );
      }

      const user = await waitFor(async () => {
        const row = await persistenceApp.prisma.user.findUniqueOrThrow({
          where: { email: RENTER_TWO.email },
        });
        return row.status === "locked" ? row : null;
      }, "the account lock");

      const suspicious = await waitForSuspiciousEvent("repeated_lockouts");
      expect(suspicious).toMatchObject({
        userId: user.id,
        outcome: "blocked",
        metadata: expect.objectContaining({
          action: "account_locked",
          count: 3,
        }),
      });
      const [locked] = await persistenceApp.prisma.authAuditEvent.findMany({
        where: { eventType: "account.locked" },
      });
      expect(locked).toMatchObject({
        userId: user.id,
        actorUserId: null,
        metadata: expect.objectContaining({
          source: "system",
          rule: "repeated_lockouts",
          sourceEventId: suspicious.id,
        }),
      });
      const lockouts = await persistenceApp.prisma.authAuditEvent.findMany({
        where: { eventType: "login.locked", userId: user.id },
      });
      expect(lockouts).toHaveLength(3);
      expect(lockouts.every((event) => event.flagged)).toBe(true);

      await waitForRabbitMqPayload<EmailJobPayload>(
        persistenceApp.infra.rabbitMq,
        "email.delivery.main",
        (payload) =>
          payload.kind === "account_locked" &&
          payload.input.to === RENTER_TWO.email,
      );

      // The right password now meets the security hold, which password reset
      // lifts.
      const held = await login({
        username: RENTER_TWO.username,
        password: PASSWORD,
        ip: "198.51.100.63",
      });
      expect(held.status).toBe(423);
      await expect(held.json()).resolves.toMatchObject({
        error: {
          details: { reason: "security_hold", recovery: "password_reset" },
        },
      });
    });
  });

  describe("rule (c): success after failures", () => {
    it("sends one suspicious_login email whose lock link works", async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await login({
          username: RENTER_ONE.username,
          password: WRONG_PASSWORD,
          ip: "198.51.100.70",
        });
      }
      const success = await login({
        username: RENTER_ONE.username,
        password: PASSWORD,
        ip: "203.0.113.170",
        deviceId: "never-seen-device",
      });
      expect(success.status).toBe(200);

      const alert = await waitForRabbitMqPayload<EmailJobPayload>(
        persistenceApp.infra.rabbitMq,
        "email.delivery.main",
        (payload) =>
          payload.kind === "suspicious_login" &&
          payload.input.to === RENTER_ONE.email,
        { timeoutMs: 10_000 },
      );
      expect(alert.input).toMatchObject({
        reason: "success_after_failures",
        ipAddress: "203.0.113.170",
        selfLockToken: expect.any(String),
      });
      const suspicious = await waitForSuspiciousEvent("success_after_failures");
      expect(suspicious.metadata).toMatchObject({
        action: "email_sent",
        count: 3,
      });

      const token = (alert.input as { selfLockToken: string }).selfLockToken;
      const locked = await request("/auth/account/self-lock", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ token }),
      });
      expect(locked.status).toBe(200);
      const [selfLock] = await persistenceApp.prisma.authAuditEvent.findMany({
        where: { eventType: "account.locked" },
      });
      expect(selfLock?.metadata).toMatchObject({
        source: "user",
        channel: "email_link",
        sourceEventId: suspicious.id,
      });
    });
  });

  describe("rule (d): refresh-token reuse", () => {
    it("queues a suspicious_login email", async () => {
      const response = await login({
        username: RENTER_ONE.username,
        password: PASSWORD,
        ip: "198.51.100.80",
      });
      expect(response.status).toBe(200);
      const accessToken = (
        (await response.json()) as { data: { accessToken: string } }
      ).data.accessToken;
      const setCookie = response.headers.get("set-cookie") ?? "";
      const refreshToken = readCookieValue(
        setCookie,
        REFRESH_TOKEN_COOKIE_NAME,
      );
      const csrfToken = readCookieValue(setCookie, CSRF_TOKEN_COOKIE_NAME);
      const headers = {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        cookie: `${REFRESH_TOKEN_COOKIE_NAME}=${refreshToken}; ${CSRF_TOKEN_COOKIE_NAME}=${csrfToken}`,
        origin: ORIGIN,
        "x-forwarded-for": "198.51.100.80",
        [CSRF_TOKEN_HEADER_NAME]: csrfToken ?? "",
      };

      const first = await request("/auth/refresh", {
        method: "POST",
        headers,
        body: JSON.stringify({ refreshToken }),
      });
      expect(first.status).toBe(200);

      // Move the rotation outside its grace period, so replaying the old
      // token is reuse rather than a racing tab.
      const [, encodedClaims] = refreshToken!.split(".");
      const { jti } = JSON.parse(
        Buffer.from(encodedClaims!, "base64url").toString("utf8"),
      ) as { jti: string };
      const redis = getRedisClient();
      const refreshKey = `auth:refresh:${jti}`;
      const record = JSON.parse((await redis.get(refreshKey))!) as {
        rotatedAt: number;
      };
      await redis.set(
        refreshKey,
        JSON.stringify({ ...record, rotatedAt: record.rotatedAt - 6 }),
        { EX: await redis.ttl(refreshKey) },
      );

      const replay = await request("/auth/refresh", {
        method: "POST",
        headers,
        body: JSON.stringify({ refreshToken }),
      });
      expect(replay.status).toBe(401);

      const alert = await waitForRabbitMqPayload<EmailJobPayload>(
        persistenceApp.infra.rabbitMq,
        "email.delivery.main",
        (payload) =>
          payload.kind === "suspicious_login" &&
          payload.input.to === RENTER_ONE.email,
        { timeoutMs: 10_000 },
      );
      expect(alert.input).toMatchObject({ reason: "refresh_reuse" });
      const suspicious = await waitForSuspiciousEvent("refresh_reuse");
      const [reuse] = await persistenceApp.prisma.authAuditEvent.findMany({
        where: { eventType: "session.refresh_reuse_detected" },
      });
      expect(reuse?.flagged).toBe(true);
      expect(suspicious.metadata).toMatchObject({
        relatedEventIds: reuse!.id,
      });
    });
  });
});
