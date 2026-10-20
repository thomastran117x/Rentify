import {
  decodeActivityCursor,
  encodeActivityCursor,
  labelForAuthAuditEvent,
  parseUserAgent,
  toSecurityActivityItem,
} from "@/features/auth/audit/auth-audit-activity";
import {
  SECURITY_ACTIVITY_CATEGORY_EVENT_TYPES,
  listSecurityActivityQuerySchema,
  type AuthAuditActivityRow,
  type AuthAuditEventType,
} from "@/features/auth/audit/auth-audit.model";
import { RequestValidationError } from "@/configuration/validation/request";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 425001);
const ADMIN_ID = testUuid(9000, 425002);
const EVENT_ID = testUuid(9000, 425003);

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

const ALL_EVENT_TYPES: AuthAuditEventType[] = [
  "login.succeeded",
  "login.failed",
  "login.mfa_challenged",
  "login.locked",
  "login.unlock_requested",
  "login.unlocked",
  "logout",
  "oauth.login.succeeded",
  "oauth.login.failed",
  "oauth.signup.completed",
  "oauth.linked",
  "oauth.unlinked",
  "session.refresh_reuse_detected",
  "session.revoked",
  "device.new_detected",
  "password.changed",
  "password.reset",
  "password.set",
  "email.changed",
  "mfa.totp_enabled",
  "mfa.totp_disabled",
  "mfa.step_up_failed",
  "mfa.step_up_locked",
  "pat.created",
  "pat.revoked",
  "rate_limit.exceeded",
];

function createRow(
  overrides: Partial<AuthAuditActivityRow> = {},
): AuthAuditActivityRow {
  return {
    id: EVENT_ID,
    userId: USER_ID,
    actorUserId: null,
    eventType: "login.succeeded",
    outcome: "success",
    reasonCode: null,
    method: "password",
    ipAddress: "203.0.113.24",
    userAgent: CHROME_WINDOWS,
    deviceId: "device-1",
    sessionId: "session-1",
    createdAt: new Date("2026-10-18T14:02:11.482Z"),
    ...overrides,
  };
}

describe("activity cursor", () => {
  it("round-trips an event id through an opaque token", () => {
    const cursor = encodeActivityCursor(EVENT_ID);

    expect(cursor).not.toContain(EVENT_ID);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeActivityCursor(cursor)).toBe(EVENT_ID);
  });

  it.each([
    ["garbage", "not-a-cursor"],
    ["a bare id", Buffer.from(EVENT_ID).toString("base64url")],
    ["a prefixed non-id", Buffer.from("v1:1 OR 1=1").toString("base64url")],
  ])("rejects %s with a validation error", (_name, cursor) => {
    expect(() => decodeActivityCursor(cursor)).toThrow(RequestValidationError);
  });
});

describe("listSecurityActivityQuerySchema", () => {
  it("defaults the limit and accepts a category", () => {
    expect(listSecurityActivityQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(
      listSecurityActivityQuerySchema.parse({
        limit: "5",
        category: "sessions",
        cursor: "abc",
      }),
    ).toEqual({ limit: 5, category: "sessions", cursor: "abc" });
  });

  it("accepts each outcome", () => {
    for (const outcome of ["success", "failure", "blocked"]) {
      expect(listSecurityActivityQuerySchema.parse({ outcome })).toEqual({
        limit: 20,
        outcome,
      });
    }
  });

  it("accepts a date range with an offset or Z", () => {
    expect(
      listSecurityActivityQuerySchema.parse({
        from: "2026-10-01T00:00:00-04:00",
        to: "2026-10-08T04:00:00.000Z",
      }),
    ).toEqual({
      limit: 20,
      from: "2026-10-01T00:00:00-04:00",
      to: "2026-10-08T04:00:00.000Z",
    });
    expect(
      listSecurityActivityQuerySchema.parse({ from: "2026-10-01T00:00:00Z" }),
    ).toEqual({ limit: 20, from: "2026-10-01T00:00:00Z" });
  });

  it.each([
    [{ limit: "0" }],
    [{ limit: "51" }],
    [{ category: "everything" }],
    [{ outcome: "succeeded" }],
    [{ userId: USER_ID }],
    [{ from: "2026-10-01" }],
    [{ to: "yesterday" }],
    [{ from: "2026-10-08T00:00:00Z", to: "2026-10-01T00:00:00Z" }],
    [{ from: "2026-10-01T00:00:00Z", to: "2026-10-01T00:00:00Z" }],
  ])("rejects %o", (query) => {
    expect(() => listSecurityActivityQuerySchema.parse(query)).toThrow();
  });
});

describe("SECURITY_ACTIVITY_CATEGORY_EVENT_TYPES", () => {
  it("puts every recorded event type in exactly one category", () => {
    const categorised = Object.values(
      SECURITY_ACTIVITY_CATEGORY_EVENT_TYPES,
    ).flat();

    expect([...categorised].sort()).toEqual([...ALL_EVENT_TYPES].sort());
    expect(new Set(categorised).size).toBe(categorised.length);
  });
});

describe("labelForAuthAuditEvent", () => {
  it.each(ALL_EVENT_TYPES)("gives %s a specific label", (eventType) => {
    const label = labelForAuthAuditEvent({
      eventType,
      reasonCode: null,
      method: "google",
      userId: USER_ID,
      actorUserId: null,
    });

    expect(label).not.toBe("Account activity");
    expect(label.length).toBeGreaterThan(0);
  });

  it.each([
    ["login.succeeded", null, "password", "Signed in with password"],
    ["login.succeeded", null, null, "Signed in with password"],
    ["login.succeeded", null, "google", "Signed in with Google"],
    [
      "login.failed",
      "bad_credentials",
      "password",
      "Failed sign-in: wrong password",
    ],
    [
      "login.failed",
      "email_unverified",
      "password",
      "Failed sign-in: email not verified",
    ],
    [
      "login.failed",
      "mfa_invalid",
      "password",
      "Failed sign-in: wrong verification code",
    ],
    ["login.failed", "locked", "password", "Sign-in blocked: account locked"],
    [
      "login.failed",
      "rate_limited",
      "password",
      "Sign-in blocked: too many attempts",
    ],
    ["login.failed", null, "password", "Failed sign-in"],
    ["oauth.login.succeeded", null, "microsoft", "Signed in with Microsoft"],
    ["oauth.login.failed", null, "apple", "Failed sign-in with Apple"],
    ["oauth.login.failed", null, null, "Failed sign-in with a provider"],
    ["oauth.signup.completed", null, "google", "Account created with Google"],
    ["oauth.linked", null, "google", "Google sign-in linked"],
    ["oauth.unlinked", null, "apple", "Apple sign-in removed"],
    [
      "rate_limit.exceeded",
      "rate_limited",
      null,
      "Too many attempts: temporarily blocked",
    ],
    ["future.event", null, null, "Account activity"],
  ])("labels %s (%s, %s) as %p", (eventType, reasonCode, method, expected) => {
    expect(
      labelForAuthAuditEvent({
        eventType,
        reasonCode,
        method,
        userId: USER_ID,
        actorUserId: null,
      }),
    ).toBe(expected);
  });

  it("describes another account's action without naming it", () => {
    expect(
      labelForAuthAuditEvent({
        eventType: "login.locked",
        reasonCode: null,
        method: null,
        userId: USER_ID,
        actorUserId: ADMIN_ID,
      }),
    ).toBe("An administrator locked your account");
    expect(
      labelForAuthAuditEvent({
        eventType: "pat.created",
        reasonCode: null,
        method: null,
        userId: USER_ID,
        actorUserId: ADMIN_ID,
      }),
    ).toBe("An administrator changed your account security");
  });

  it("treats the user acting on their own account as a normal event", () => {
    expect(
      labelForAuthAuditEvent({
        eventType: "logout",
        reasonCode: null,
        method: null,
        userId: USER_ID,
        actorUserId: USER_ID,
      }),
    ).toBe("Signed out");
  });
});

describe("parseUserAgent", () => {
  it.each([
    [CHROME_WINDOWS, "Chrome", "Windows"],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.79",
      "Edge",
      "Windows",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      "Safari",
      "macOS",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
      "Chrome",
      "iOS",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
      "Samsung Internet",
      "Android",
    ],
    [
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Firefox",
      "Linux",
    ],
    [
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0",
      "Opera",
      "ChromeOS",
    ],
    ["curl/8.9.1", null, null],
  ])("parses %s", (userAgent, browser, os) => {
    expect(parseUserAgent(userAgent)).toEqual({ browser, os });
  });

  it.each([[null], [undefined], [""]])("returns nulls for %p", (userAgent) => {
    expect(parseUserAgent(userAgent)).toEqual({ browser: null, os: null });
  });
});

describe("toSecurityActivityItem", () => {
  it("projects only the user-safe fields", () => {
    const item = toSecurityActivityItem(
      createRow({ actorUserId: USER_ID, reasonCode: "bad_credentials" }),
      { currentSessionId: "session-1", knownDeviceIds: new Set(["device-1"]) },
    );

    expect(item).toEqual({
      id: EVENT_ID,
      type: "login.succeeded",
      outcome: "success",
      label: "Signed in with password",
      occurredAt: "2026-10-18T14:02:11.482Z",
      method: "password",
      ipAddress: "203.0.113.24",
      browser: "Chrome",
      os: "Windows",
      deviceKnown: true,
      current: true,
    });
  });

  it("hides the administrator's IP, device and method on events they performed", () => {
    const item = toSecurityActivityItem(
      createRow({
        eventType: "login.locked",
        outcome: "blocked",
        actorUserId: ADMIN_ID,
        method: "password",
        ipAddress: "192.0.2.99",
        userAgent: CHROME_WINDOWS,
        deviceId: "device-1",
        sessionId: "session-1",
      }),
      { currentSessionId: "session-1", knownDeviceIds: new Set(["device-1"]) },
    );

    expect(item).toEqual({
      id: EVENT_ID,
      type: "login.locked",
      outcome: "blocked",
      label: "An administrator locked your account",
      occurredAt: "2026-10-18T14:02:11.482Z",
      method: null,
      ipAddress: null,
      browser: null,
      os: null,
      deviceKnown: false,
      current: false,
    });
  });

  it("flags other sessions and unknown devices", () => {
    const item = toSecurityActivityItem(
      createRow({ sessionId: "session-2", deviceId: "device-9" }),
      { currentSessionId: "session-1", knownDeviceIds: new Set(["device-1"]) },
    );

    expect(item.current).toBe(false);
    expect(item.deviceKnown).toBe(false);
  });

  it("never marks a session-less event as current", () => {
    const item = toSecurityActivityItem(
      createRow({ sessionId: null, deviceId: null }),
      { currentSessionId: undefined, knownDeviceIds: new Set() },
    );

    expect(item.current).toBe(false);
    expect(item.deviceKnown).toBe(false);
  });

  it("normalises unexpected outcome and method values", () => {
    const item = toSecurityActivityItem(
      createRow({ outcome: "weird", method: "carrier-pigeon" }),
      { knownDeviceIds: new Set() },
    );

    expect(item.outcome).toBe("failure");
    expect(item.method).toBeNull();
  });
});
