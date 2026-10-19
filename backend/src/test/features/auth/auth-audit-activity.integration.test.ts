import { randomUUID } from "node:crypto";
import { buildApiPath } from "@/configuration/http/api-path";
import {
  CSRF_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_HEADER_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/features/auth/auth.cookies";
import { encodeActivityCursor } from "@/features/auth/audit/auth-audit-activity";
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
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
// owner-one must pass a real step-up; user1 is on the harness's MFA bypass list.
const OWNER_USERNAME = "owner-one";
const OWNER_EMAIL = "owner1@rentify.local";
const RENTER_EMAIL = "user1@rentify.local";

const ITEM_KEYS = [
  "browser",
  "current",
  "deviceKnown",
  "id",
  "ipAddress",
  "label",
  "method",
  "occurredAt",
  "os",
  "outcome",
  "type",
];

interface ActivityItem {
  id: string;
  type: string;
  outcome: string;
  label: string;
  occurredAt: string;
  method: string | null;
  ipAddress: string | null;
  browser: string | null;
  os: string | null;
  deviceKnown: boolean;
  current: boolean;
}

interface ActivityPage {
  items: ActivityItem[];
  nextCursor: string | null;
}

function readCookieValue(setCookieHeader: string, name: string): string | null {
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1] ?? null;
}

describe("Security activity (GET /auth/audit/me) integration", () => {
  let persistenceApp: PersistenceTestApp;

  async function loginOwner(password: string) {
    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "user-agent": CHROME_WINDOWS,
          "x-device-id": "activity-test-device",
        },
        body: JSON.stringify({
          username: OWNER_USERNAME,
          password,
          captchaToken: "captcha-ok-login",
        }),
      },
    );
    const body = (await response.json()) as {
      data?: { accessToken?: string };
    };
    const setCookie = response.headers.get("set-cookie") ?? "";
    const accessToken = body.data?.accessToken ?? "";
    const refreshToken = readCookieValue(setCookie, REFRESH_TOKEN_COOKIE_NAME);
    const csrfToken = readCookieValue(setCookie, CSRF_TOKEN_COOKIE_NAME);

    return {
      status: response.status,
      headers: (): Record<string, string> => ({
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "user-agent": CHROME_WINDOWS,
        origin: ORIGIN,
        cookie: `${REFRESH_TOKEN_COOKIE_NAME}=${refreshToken}; ${CSRF_TOKEN_COOKIE_NAME}=${csrfToken}`,
        [CSRF_TOKEN_HEADER_NAME]: csrfToken ?? "",
      }),
    };
  }

  async function completeMfaStepUp(
    headers: Record<string, string>,
  ): Promise<void> {
    const challenge = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/mfa/verify/challenge")}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ scope: "mfa-management", factor: "email" }),
      },
    );
    expect(challenge.status).toBe(200);

    const preview = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/mfa/verify/dev/otp?scope=mfa-management")}`,
      { headers },
    );
    expect(preview.status).toBe(200);
    const { data } = (await preview.json()) as { data: { code: string } };

    const confirm = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/mfa/verify/confirm")}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          scope: "mfa-management",
          factor: "email",
          code: data.code,
        }),
      },
    );
    expect(confirm.status).toBe(200);
  }

  function getActivity(query: string, headers: Record<string, string> = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/auth/audit/me${query}`)}`,
      { headers },
    );
  }

  async function readPage(response: Response): Promise<ActivityPage> {
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: ActivityPage };
    return body.data;
  }

  async function findUserId(email: string): Promise<string> {
    const user = await persistenceApp.prisma.user.findUniqueOrThrow({
      where: { email },
    });
    return user.id;
  }

  /** Inserts events with explicit timestamps, oldest first. */
  async function seedEvents(
    userId: string | null,
    events: Array<{ eventType: string; outcome: string; createdAt: Date }>,
  ): Promise<string[]> {
    const rows = events.map((event) => ({
      id: randomUUID(),
      userId,
      eventType: event.eventType,
      outcome: event.outcome,
      ipAddress: "198.51.100.7",
      userAgent: CHROME_WINDOWS,
      identifierHash: "f".repeat(64),
      requestId: "seeded-request",
      metadata: { seeded: true },
      createdAt: event.createdAt,
    }));
    await persistenceApp.prisma.authAuditEvent.createMany({ data: rows });
    return rows.map((row) => row.id);
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

  it("requires authentication", async () => {
    const response = await getActivity("");

    expect(response.status).toBe(401);
  });

  it("requires a recent step-up, then lists the caller's real sign-in history", async () => {
    const failed = await loginOwner(WRONG_PASSWORD);
    expect(failed.status).toBe(401);
    const session = await loginOwner(PASSWORD);
    expect(session.status).toBe(200);

    const blocked = await getActivity("", session.headers());
    expect(blocked.status).toBe(401);
    await expect(blocked.json()).resolves.toMatchObject({
      error: { code: "MFA_VERIFICATION_REQUIRED" },
    });

    await completeMfaStepUp(session.headers());
    const page = await readPage(await getActivity("", session.headers()));

    const signIns = page.items.filter((item) => item.type.startsWith("login."));
    expect(
      signIns.map((item) => [item.type, item.outcome, item.label]),
    ).toEqual([
      ["login.succeeded", "success", "Signed in with password"],
      ["login.failed", "failure", "Failed sign-in: wrong password"],
    ]);
    expect(signIns[0]).toMatchObject({
      method: "password",
      browser: "Chrome",
      os: "Windows",
      current: true,
    });
    expect(signIns[1]!.current).toBe(false);
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
    }
  });

  it("isolates users, pages through a tie on created_at and filters by category", async () => {
    const renterId = await findUserId(RENTER_EMAIL);
    const ownerId = await findUserId(OWNER_EMAIL);
    const base = Date.UTC(2026, 9, 1, 12, 0, 0);
    const sameInstant = new Date(base + 2_000);
    const renterIds = await seedEvents(renterId, [
      {
        eventType: "login.succeeded",
        outcome: "success",
        createdAt: new Date(base),
      },
      {
        eventType: "login.failed",
        outcome: "failure",
        createdAt: new Date(base + 1_000),
      },
      {
        eventType: "session.revoked",
        outcome: "success",
        createdAt: sameInstant,
      },
      {
        eventType: "session.revoked",
        outcome: "success",
        createdAt: sameInstant,
      },
      {
        eventType: "password.changed",
        outcome: "success",
        createdAt: new Date(base + 3_000),
      },
    ]);
    const ownerIds = await seedEvents(ownerId, [
      {
        eventType: "login.succeeded",
        outcome: "success",
        createdAt: new Date(base + 500),
      },
    ]);
    const anonymousIds = await seedEvents(null, [
      {
        eventType: "login.failed",
        outcome: "failure",
        createdAt: new Date(base + 1_500),
      },
    ]);
    const renter = await createAuthenticatedRequestContext({
      email: RENTER_EMAIL,
    });

    const seen: ActivityItem[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor
        ? `?limit=2&cursor=${encodeURIComponent(cursor)}`
        : "?limit=2";
      const page = await readPage(await getActivity(query, renter.headers()));
      seen.push(...page.items);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(seen.map((item) => item.id).sort()).toEqual([...renterIds].sort());
    expect(seen[0]!.type).toBe("password.changed");
    expect(seen.at(-1)!.type).toBe("login.succeeded");
    const times = seen.map((item) => Date.parse(item.occurredAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const ids = seen.map((item) => item.id);
    for (const foreign of [...ownerIds, ...anonymousIds]) {
      expect(ids).not.toContain(foreign);
    }
    for (const item of seen) {
      expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
    }

    const sessions = await readPage(
      await getActivity("?category=sessions", renter.headers()),
    );
    expect(sessions.items.map((item) => item.type)).toEqual([
      "session.revoked",
      "session.revoked",
    ]);
    const changes = await readPage(
      await getActivity("?category=security_changes", renter.headers()),
    );
    expect(changes.items.map((item) => item.label)).toEqual([
      "Password changed",
    ]);

    // A cursor naming another user's event matches none of the caller's rows,
    // so it yields an empty last page rather than anything of theirs.
    const crossCursor = await readPage(
      await getActivity(
        `?cursor=${encodeActivityCursor(ownerIds[0]!)}`,
        renter.headers(),
      ),
    );
    expect(crossCursor).toEqual({ items: [], nextCursor: null });
  });

  it("limits the list to a date range that combines with category and paging", async () => {
    const renterId = await findUserId(RENTER_EMAIL);
    const day = (n: number) => new Date(Date.UTC(2026, 8, n, 12, 0, 0));
    const ids = await seedEvents(renterId, [
      { eventType: "login.succeeded", outcome: "success", createdAt: day(1) },
      { eventType: "login.failed", outcome: "failure", createdAt: day(3) },
      { eventType: "login.succeeded", outcome: "success", createdAt: day(4) },
      { eventType: "logout", outcome: "success", createdAt: day(5) },
      { eventType: "login.succeeded", outcome: "success", createdAt: day(9) },
    ]);
    const renter = await createAuthenticatedRequestContext({
      email: RENTER_EMAIL,
    });
    const range = `from=${encodeURIComponent("2026-09-03T00:00:00Z")}&to=${encodeURIComponent("2026-09-06T00:00:00Z")}`;

    const all = await readPage(
      await getActivity(`?${range}`, renter.headers()),
    );
    expect(all.items.map((item) => item.id)).toEqual([ids[3], ids[2], ids[1]]);

    const signIns = await readPage(
      await getActivity(`?${range}&category=sign_in&limit=1`, renter.headers()),
    );
    expect(signIns.items.map((item) => item.id)).toEqual([ids[2]]);
    const next = await readPage(
      await getActivity(
        `?${range}&category=sign_in&limit=1&cursor=${signIns.nextCursor}`,
        renter.headers(),
      ),
    );
    expect(next.items.map((item) => item.id)).toEqual([ids[1]]);
    expect(next.nextCursor).toBeNull();

    const failures = await readPage(
      await getActivity(`?${range}&outcome=failure`, renter.headers()),
    );
    expect(failures.items.map((item) => [item.id, item.outcome])).toEqual([
      [ids[1], "failure"],
    ]);

    // `to` is exclusive: an event exactly on the bound is left out.
    const exclusive = await readPage(
      await getActivity(
        `?from=${encodeURIComponent(day(4).toISOString())}&to=${encodeURIComponent(day(5).toISOString())}`,
        renter.headers(),
      ),
    );
    expect(exclusive.items.map((item) => item.id)).toEqual([ids[2]]);
  });

  it.each([
    ["an unknown parameter", `?userId=${randomUUID()}`],
    ["a date without a time", "?from=2026-09-01"],
    ["an unknown outcome", "?outcome=succeeded"],
    [
      "a range that ends before it starts",
      `?from=${encodeURIComponent("2026-09-05T00:00:00Z")}&to=${encodeURIComponent("2026-09-01T00:00:00Z")}`,
    ],
    ["a malformed cursor", "?cursor=not-a-cursor"],
    ["an out-of-range limit", "?limit=51"],
    ["an unknown category", "?category=everything"],
  ])("rejects %s with a validation error", async (_name, query) => {
    const renter = await createAuthenticatedRequestContext({
      email: RENTER_EMAIL,
    });

    const response = await getActivity(query, renter.headers());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });
});
