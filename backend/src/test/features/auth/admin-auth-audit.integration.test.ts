import { randomUUID } from "node:crypto";
import { containerTokens } from "@/configuration/container/tokens";
import { buildApiPath } from "@/configuration/http/api-path";
import { encodeActivityCursor } from "@/features/auth/audit/auth-audit-activity";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type AuthenticatedRequestContext,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const ORIGIN = "http://localhost:3040";
const ADMIN_EMAIL = "admin1@rentify.local";
const MODERATOR_EMAIL = "moderator1@rentify.local";
const OWNER_EMAIL = "owner1@rentify.local";
const RENTER_EMAIL = "user1@rentify.local";
const RENTER_USERNAME = "renter-one";
const WRONG_PASSWORD = "WrongPassword1!";
const STUFFING_IP = "198.51.100.66";
const UNKNOWN_USERNAME = "nobody-by-this-name";
const HOUR_IN_MS = 60 * 60 * 1000;

interface AuditEvent {
  id: string;
  eventType: string;
  outcome: string;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  subject: { id: string; email: string; username: string | null } | null;
  actor: { id: string; email: string; username: string | null } | null;
}

interface AuditPage {
  items: AuditEvent[];
  nextCursor: string | null;
  range: { from: string; to: string };
}

describe("Admin auth audit (GET /admin/auth/audit, /admin/users/:id/security) integration", () => {
  let persistenceApp: PersistenceTestApp;
  let admin: AuthenticatedRequestContext;
  let renterId: string;

  function request(path: string, init: RequestInit = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  function listEvents(query: string, headers = admin.headers()) {
    return request(`/admin/auth/audit${query}`, { headers });
  }

  async function readPage(response: Response): Promise<AuditPage> {
    expect(response.status).toBe(200);
    return ((await response.json()) as { data: AuditPage }).data;
  }

  async function findUserId(email: string): Promise<string> {
    const user = await persistenceApp.prisma.user.findUniqueOrThrow({
      where: { email },
    });
    return user.id;
  }

  async function seedEvent(input: {
    userId: string | null;
    eventType: string;
    outcome: string;
    ipAddress?: string;
    identifierHash?: string;
    createdAt: Date;
  }): Promise<string> {
    const id = randomUUID();
    await persistenceApp.prisma.authAuditEvent.create({
      data: {
        id,
        userId: input.userId,
        eventType: input.eventType,
        outcome: input.outcome,
        ipAddress: input.ipAddress ?? "203.0.113.10",
        identifierHash: input.identifierHash ?? "f".repeat(64),
        createdAt: input.createdAt,
      },
    });
    return id;
  }

  function hoursAgo(hours: number): Date {
    return new Date(Date.now() - hours * HOUR_IN_MS);
  }

  function auditViewedRows() {
    return persistenceApp.prisma.authAuditEvent.findMany({
      where: { eventType: "admin.audit_viewed" },
      orderBy: { createdAt: "asc" },
    });
  }

  async function failLogin(username: string) {
    return request("/auth/local/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-device-id": "admin-audit-test-device",
      },
      body: JSON.stringify({
        username,
        password: WRONG_PASSWORD,
        captchaToken: "captcha-ok-login",
      }),
    });
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
    await persistenceApp.prisma.authAuditEvent.deleteMany({});
    admin = await createAuthenticatedRequestContext({ email: ADMIN_EMAIL });
    renterId = await findUserId(RENTER_EMAIL);
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  describe("access", () => {
    it("requires authentication on both endpoints", async () => {
      expect((await request("/admin/auth/audit")).status).toBe(401);
      expect((await request(`/admin/users/${renterId}/security`)).status).toBe(
        401,
      );
    });

    it.each([RENTER_EMAIL, OWNER_EMAIL, MODERATOR_EMAIL])(
      "forbids %s on both endpoints and records nothing",
      async (email) => {
        const caller = await createAuthenticatedRequestContext({ email });

        const list = await listEvents("", caller.headers());
        const summary = await request(`/admin/users/${renterId}/security`, {
          headers: caller.headers(),
        });

        expect(list.status).toBe(403);
        expect(summary.status).toBe(403);
        expect(await auditViewedRows()).toEqual([]);
      },
    );

    it("lets an admin read both endpoints", async () => {
      expect((await listEvents("")).status).toBe(200);
      expect(
        (
          await request(`/admin/users/${renterId}/security`, {
            headers: admin.headers(),
          })
        ).status,
      ).toBe(200);
    });

    it("rejects an admin's personal access token", async () => {
      const created = await request("/auth/personal-access-tokens", {
        method: "POST",
        headers: { ...admin.headers(), origin: ORIGIN },
        body: JSON.stringify({
          name: "Admin audit suite",
          scopes: ["mcp:read"],
          expiresInDays: 30,
        }),
      });
      expect(created.status).toBe(201);
      const { data } = (await created.json()) as { data: { token: string } };

      const response = await listEvents("", {
        authorization: `Bearer ${data.token}`,
        "content-type": "application/json",
        origin: ORIGIN,
      });

      expect(response.status).toBe(403);
    });
  });

  describe("filters", () => {
    let ids: Record<string, string>;
    let unknownHash: string;

    beforeEach(async () => {
      const ownerId = await findUserId(OWNER_EMAIL);
      unknownHash = persistenceApp.container
        .resolve<AuthAuditService>(containerTokens.authAuditService)
        .hashIdentifier(UNKNOWN_USERNAME);

      ids = {
        renterFailed: await seedEvent({
          userId: renterId,
          eventType: "login.failed",
          outcome: "failure",
          ipAddress: STUFFING_IP,
          createdAt: hoursAgo(1),
        }),
        renterLocked: await seedEvent({
          userId: renterId,
          eventType: "login.locked",
          outcome: "blocked",
          ipAddress: STUFFING_IP,
          createdAt: hoursAgo(2),
        }),
        renterSucceeded: await seedEvent({
          userId: renterId,
          eventType: "login.succeeded",
          outcome: "success",
          createdAt: hoursAgo(3),
        }),
        unknownFailed: await seedEvent({
          userId: null,
          eventType: "login.failed",
          outcome: "failure",
          ipAddress: STUFFING_IP,
          identifierHash: unknownHash,
          createdAt: hoursAgo(4),
        }),
        ownerSucceeded: await seedEvent({
          userId: ownerId,
          eventType: "login.succeeded",
          outcome: "success",
          createdAt: hoursAgo(5),
        }),
        renterOld: await seedEvent({
          userId: renterId,
          eventType: "login.failed",
          outcome: "failure",
          createdAt: hoursAgo(24 * 8),
        }),
      };
    });

    async function listIds(query: string): Promise<string[]> {
      const page = await readPage(await listEvents(query));
      return page.items
        .filter((item) => item.eventType !== "admin.audit_viewed")
        .map((item) => item.id);
    }

    it("lists the last seven days newest first by default, naming each subject", async () => {
      const page = await readPage(await listEvents(""));
      const events = page.items.filter(
        (item) => item.eventType !== "admin.audit_viewed",
      );

      expect(events.map((item) => item.id)).toEqual([
        ids.renterFailed,
        ids.renterLocked,
        ids.renterSucceeded,
        ids.unknownFailed,
        ids.ownerSucceeded,
      ]);
      expect(events[0].subject).toEqual({
        id: renterId,
        email: RENTER_EMAIL,
        username: RENTER_USERNAME,
      });
      expect(events[3].subject).toBeNull();
      expect(events[0]).not.toHaveProperty("identifierHash");
      expect(Date.parse(page.range.to) - Date.parse(page.range.from)).toBe(
        7 * 24 * HOUR_IN_MS,
      );
    });

    it("filters by user id, email and username alike", async () => {
      const expected = [
        ids.renterFailed,
        ids.renterLocked,
        ids.renterSucceeded,
      ];

      expect(await listIds(`?userId=${renterId}`)).toEqual(expected);
      expect(
        await listIds(
          `?user=${encodeURIComponent(RENTER_EMAIL.toUpperCase())}`,
        ),
      ).toEqual(expected);
      expect(await listIds(`?user=${RENTER_USERNAME}`)).toEqual(expected);
    });

    it("finds attempts against an unknown username by what was typed", async () => {
      expect(await listIds(`?user=${UNKNOWN_USERNAME}`)).toEqual([
        ids.unknownFailed,
      ]);
    });

    it("filters by IP to show a credential-stuffing burst across accounts", async () => {
      expect(await listIds(`?ip=${STUFFING_IP}`)).toEqual([
        ids.renterFailed,
        ids.renterLocked,
        ids.unknownFailed,
      ]);
    });

    it("filters by repeated event types and by outcome", async () => {
      expect(
        await listIds("?eventType=login.locked&eventType=login.succeeded"),
      ).toEqual([ids.renterLocked, ids.renterSucceeded, ids.ownerSucceeded]);
      expect(await listIds("?outcome=failure")).toEqual([
        ids.renterFailed,
        ids.unknownFailed,
      ]);
    });

    it("filters by an explicit date range", async () => {
      const from = hoursAgo(24 * 9).toISOString();
      const to = hoursAgo(2.5).toISOString();

      expect(
        await listIds(
          `?userId=${renterId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        ),
      ).toEqual([ids.renterSucceeded, ids.renterOld]);
    });

    it("pages with a cursor and rejects one sent with other filters", async () => {
      const first = await readPage(
        await listEvents(`?userId=${renterId}&limit=2`),
      );
      expect(first.items.map((item) => item.id)).toEqual([
        ids.renterFailed,
        ids.renterLocked,
      ]);
      expect(first.nextCursor).not.toBeNull();

      const second = await readPage(
        await listEvents(
          `?userId=${renterId}&limit=2&cursor=${first.nextCursor}`,
        ),
      );
      expect(second.items.map((item) => item.id)).toEqual([
        ids.renterSucceeded,
      ]);
      expect(second.nextCursor).toBeNull();

      const mismatched = await listEvents(
        `?ip=203.0.113.99&limit=2&cursor=${first.nextCursor}`,
      );
      expect(mismatched.status).toBe(400);

      const foreign = await listEvents(
        `?userId=${renterId}&cursor=${encodeActivityCursor(ids.ownerSucceeded)}`,
      );
      expect(foreign.status).toBe(400);
    });

    it.each([
      [
        "both user filters",
        `?userId=00000000-0000-0000-0000-000000000001&user=x`,
      ],
      [
        "an inverted range",
        "?from=2026-10-10T00:00:00Z&to=2026-10-01T00:00:00Z",
      ],
      [
        "a range over 90 days",
        "?from=2026-01-01T00:00:00Z&to=2026-10-01T00:00:00Z",
      ],
      ["an unknown event type", "?eventType=login.nope"],
      ["a malformed IP", "?ip=999.1.1.1"],
      ["an unknown parameter", "?identifierHash=abc"],
    ])("rejects %s", async (_label, query) => {
      expect((await listEvents(query)).status).toBe(400);
    });
  });

  describe("self-audit", () => {
    it("records each list read with the reader as actor and the filters used", async () => {
      await readPage(
        await listEvents(
          `?user=${RENTER_USERNAME}&ip=${STUFFING_IP}&eventType=login.failed&eventType=login.locked`,
        ),
      );
      await readPage(await listEvents("?outcome=blocked"));

      const rows = await auditViewedRows();

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        userId: null,
        actorUserId: admin.userId,
        outcome: "success",
      });
      expect(rows[0].metadata).toMatchObject({
        view: "events",
        filter_user: RENTER_USERNAME,
        filter_ip: STUFFING_IP,
        filter_event_types: "login.failed,login.locked",
      });
      expect(rows[1].metadata).toMatchObject({ filter_outcome: "blocked" });
    });

    it("shows earlier reads to the next search for admin.audit_viewed", async () => {
      await readPage(await listEvents("?outcome=failure"));

      const page = await readPage(
        await listEvents("?eventType=admin.audit_viewed"),
      );

      // The search's window ends when it starts, so its own row, written
      // just after, is not part of its result; only the earlier read is.
      expect(page.items).toHaveLength(1);
      expect(page.items[0].metadata).toMatchObject({
        filter_outcome: "failure",
      });
      expect(page.items[0].actor).toEqual({
        id: admin.userId,
        email: ADMIN_EMAIL,
        username: "admin-one",
      });
      expect(page.items[0].subject).toBeNull();
    });

    it("records a summary read naming its target", async () => {
      await request(`/admin/users/${renterId}/security`, {
        headers: admin.headers(),
      });

      const rows = await auditViewedRows();

      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).toEqual({
        view: "user_summary",
        target_user_id: renterId,
      });
    });
  });

  describe("user security summary", () => {
    it("shows the live lockout, counts, devices and recent events", async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await failLogin(RENTER_USERNAME);
      }

      const response = await request(`/admin/users/${renterId}/security`, {
        headers: admin.headers(),
      });
      expect(response.status).toBe(200);
      const { data } = (await response.json()) as {
        data: {
          user: { id: string; username: string; role: string };
          accountStatus: string;
          failedSignIns: { last24Hours: number; last7Days: number };
          lockout: {
            locked: boolean;
            failedAttempts: number;
            lockedAt: string | null;
            lockedUntil: string | null;
          };
          devices: Array<{ deviceId: string }>;
          recentEvents: AuditEvent[];
        };
      };

      expect(data.user).toMatchObject({
        id: renterId,
        username: RENTER_USERNAME,
        role: "user",
      });
      expect(data.accountStatus).toBe("active");
      expect(data.lockout.locked).toBe(true);
      expect(data.lockout.failedAttempts).toBe(5);
      expect(
        Date.parse(data.lockout.lockedUntil!) -
          Date.parse(data.lockout.lockedAt!),
      ).toBe(30 * 60 * 1000);
      expect(data.failedSignIns.last24Hours).toBeGreaterThanOrEqual(4);
      expect(data.failedSignIns.last7Days).toBe(data.failedSignIns.last24Hours);
      expect(data.devices.length).toBeGreaterThan(0);
      expect(data.recentEvents.length).toBeGreaterThan(0);
      expect(data.recentEvents.length).toBeLessThanOrEqual(20);
      expect(
        data.recentEvents.every((event) => event.subject?.id === renterId),
      ).toBe(true);
      expect(
        data.recentEvents.some((event) => event.eventType === "login.failed"),
      ).toBe(true);
    });

    it("reports an unlocked account with no failures", async () => {
      const response = await request(`/admin/users/${renterId}/security`, {
        headers: admin.headers(),
      });
      const { data } = (await response.json()) as {
        data: {
          failedSignIns: { last24Hours: number };
          lockout: { locked: boolean; failedAttempts: number };
        };
      };

      expect(data.lockout).toEqual({
        locked: false,
        failedAttempts: 0,
        lockedAt: null,
        lockedUntil: null,
      });
      expect(data.failedSignIns.last24Hours).toBe(0);
    });

    it("is a 404 for an unknown account and a 400 for a malformed id", async () => {
      const unknown = await request(`/admin/users/${randomUUID()}/security`, {
        headers: admin.headers(),
      });
      const malformed = await request("/admin/users/not-an-id/security", {
        headers: admin.headers(),
      });

      expect(unknown.status).toBe(404);
      expect(malformed.status).toBe(400);
      expect(await auditViewedRows()).toEqual([]);
    });
  });
});
