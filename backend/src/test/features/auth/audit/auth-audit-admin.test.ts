import {
  collectReferencedUserIds,
  resolveAdminAuditRange,
  toAdminAuthAuditEvent,
  toAdminRepositoryFilter,
  toAuditViewedMetadata,
} from "@/features/auth/audit/auth-audit-admin";
import {
  adminAuthAuditQuerySchema,
  type AdminAuthAuditQuery,
  type AuthAuditAdminRow,
} from "@/features/auth/audit/auth-audit-admin.model";
import { RequestValidationError } from "@/configuration/validation/request";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 376101);
const ADMIN_ID = testUuid(9000, 376102);
const NOW = new Date("2026-10-18T12:00:00.000Z");
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

function parse(input: Record<string, unknown>): AdminAuthAuditQuery {
  return adminAuthAuditQuerySchema.parse(input);
}

function createRow(
  overrides: Partial<AuthAuditAdminRow> = {},
): AuthAuditAdminRow {
  return {
    id: testUuid(9100, 1),
    userId: USER_ID,
    actorUserId: null,
    eventType: "login.failed",
    outcome: "failure",
    reasonCode: "bad_credentials",
    method: "password",
    ipAddress: "203.0.113.7",
    userAgent: CHROME_WINDOWS,
    deviceId: "device-1",
    sessionId: null,
    requestId: "request-1",
    metadata: null,
    createdAt: new Date("2026-10-18T11:00:00.000Z"),
    ...overrides,
  };
}

describe("adminAuthAuditQuerySchema", () => {
  it("defaults the page size and accepts every filter", () => {
    expect(
      parse({
        userId: USER_ID,
        ip: "2001:db8::1",
        eventType: ["login.failed", "admin.audit_viewed"],
        outcome: "blocked",
        from: "2026-10-11T00:00:00Z",
        to: "2026-10-18T00:00:00-04:00",
      }),
    ).toEqual({
      userId: USER_ID,
      ip: "2001:db8::1",
      eventType: ["login.failed", "admin.audit_viewed"],
      outcome: "blocked",
      from: "2026-10-11T00:00:00Z",
      to: "2026-10-18T00:00:00-04:00",
      limit: 25,
    });
  });

  it.each([
    [{ userId: USER_ID, user: "renter-one" }, "user"],
    [{ ip: "not-an-ip" }, "ip"],
    [{ eventType: ["login.nope"] }, "eventType.0"],
    [{ eventType: Array(11).fill("login.failed") }, "eventType"],
    [{ limit: "101" }, "limit"],
    [{ userId: "renter-one" }, "userId"],
    [{ from: "yesterday" }, "from"],
    [{ unexpected: "1" }, ""],
  ])("rejects %j", (input, path) => {
    const result = adminAuthAuditQuerySchema.safeParse(input);

    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path.join(".")).toBe(path);
  });
});

describe("resolveAdminAuditRange", () => {
  it("defaults to the seven days before now", () => {
    expect(resolveAdminAuditRange({}, NOW)).toEqual({
      createdFrom: new Date("2026-10-11T12:00:00.000Z"),
      createdBefore: NOW,
    });
  });

  it("defaults `from` to seven days before an explicit `to`", () => {
    expect(resolveAdminAuditRange({ to: "2026-10-01T00:00:00Z" }, NOW)).toEqual(
      {
        createdFrom: new Date("2026-09-24T00:00:00.000Z"),
        createdBefore: new Date("2026-10-01T00:00:00.000Z"),
      },
    );
  });

  it("keeps an explicit `from` with the default `to`", () => {
    expect(
      resolveAdminAuditRange({ from: "2026-09-01T00:00:00Z" }, NOW).createdFrom,
    ).toEqual(new Date("2026-09-01T00:00:00.000Z"));
  });

  it.each([
    [{ from: "2026-10-18T12:00:00Z" }, "earlier"],
    [{ from: "2026-10-19T00:00:00Z", to: "2026-10-18T00:00:00Z" }, "earlier"],
    [{ from: "2026-07-01T00:00:00Z" }, "90 days"],
  ])("rejects the window %j", (query, message) => {
    expect(() => resolveAdminAuditRange(query, NOW)).toThrow(
      RequestValidationError,
    );

    try {
      resolveAdminAuditRange(query, NOW);
    } catch (error) {
      expect((error as RequestValidationError).details).toEqual([
        { path: "from", message: expect.stringContaining(message) },
      ]);
    }
  });
});

describe("toAdminRepositoryFilter", () => {
  const range = {
    createdFrom: new Date("2026-10-11T00:00:00.000Z"),
    createdBefore: NOW,
  };

  it("maps a resolved user and every filter, asking for one extra row", () => {
    expect(
      toAdminRepositoryFilter(
        parse({
          ip: "203.0.113.7",
          eventType: ["login.failed"],
          outcome: "failure",
          limit: "10",
        }),
        { kind: "user", userId: USER_ID },
        range,
        "event-9",
      ),
    ).toEqual({
      userId: USER_ID,
      ipAddress: "203.0.113.7",
      eventTypes: ["login.failed"],
      outcome: "failure",
      afterId: "event-9",
      createdFrom: range.createdFrom,
      createdBefore: range.createdBefore,
      limit: 11,
    });
  });

  it("searches by hash for an identifier that matched no account", () => {
    expect(
      toAdminRepositoryFilter(
        parse({ user: "ghost" }),
        { kind: "identifier", identifierHash: "c".repeat(64) },
        range,
        undefined,
      ),
    ).toEqual({
      identifierHash: "c".repeat(64),
      afterId: undefined,
      createdFrom: range.createdFrom,
      createdBefore: range.createdBefore,
      limit: 26,
    });
  });

  it("adds no subject filter when none was asked for", () => {
    const filter = toAdminRepositoryFilter(
      parse({}),
      { kind: "none" },
      range,
      undefined,
    );

    expect(filter).not.toHaveProperty("userId");
    expect(filter).not.toHaveProperty("identifierHash");
  });
});

describe("toAuditViewedMetadata", () => {
  it("flattens the filters and the applied range, never the cursor", () => {
    expect(
      toAuditViewedMetadata(
        parse({
          user: "renter-one",
          ip: "203.0.113.7",
          eventType: ["login.failed", "login.locked"],
          outcome: "failure",
          cursor: "abc",
        }),
        {
          createdFrom: new Date("2026-10-11T00:00:00.000Z"),
          createdBefore: NOW,
        },
      ),
    ).toEqual({
      view: "events",
      filter_user: "renter-one",
      filter_ip: "203.0.113.7",
      filter_event_types: "login.failed,login.locked",
      filter_outcome: "failure",
      filter_from: "2026-10-11T00:00:00.000Z",
      filter_to: "2026-10-18T12:00:00.000Z",
      limit: 25,
    });
  });

  it("records a user id filter", () => {
    expect(
      toAuditViewedMetadata(parse({ userId: USER_ID }), {
        createdFrom: NOW,
        createdBefore: NOW,
      }),
    ).toMatchObject({ filter_user_id: USER_ID });
  });
});

describe("collectReferencedUserIds", () => {
  it("collects subjects and distinct actors once each", () => {
    expect(
      collectReferencedUserIds([
        { userId: USER_ID, actorUserId: null },
        { userId: USER_ID, actorUserId: USER_ID },
        { userId: null, actorUserId: ADMIN_ID },
        { userId: null, actorUserId: null },
      ]),
    ).toEqual([USER_ID, ADMIN_ID]);
  });
});

describe("toAdminAuthAuditEvent", () => {
  const usersById = new Map([
    [USER_ID, { id: USER_ID, email: "user@example.com", username: "user" }],
    [ADMIN_ID, { id: ADMIN_ID, email: "admin@example.com", username: "admin" }],
  ]);

  it("projects every column but the identifier hash, with the subject named", () => {
    const event = toAdminAuthAuditEvent(
      { ...createRow(), identifierHash: "a".repeat(64) } as AuthAuditAdminRow,
      usersById,
    );

    expect(event).toEqual({
      id: testUuid(9100, 1),
      eventType: "login.failed",
      outcome: "failure",
      reasonCode: "bad_credentials",
      method: "password",
      ipAddress: "203.0.113.7",
      userAgent: CHROME_WINDOWS,
      browser: "Chrome",
      os: "Windows",
      deviceId: "device-1",
      sessionId: null,
      requestId: "request-1",
      metadata: null,
      occurredAt: "2026-10-18T11:00:00.000Z",
      subject: { id: USER_ID, email: "user@example.com", username: "user" },
      actor: null,
    });
    expect(event).not.toHaveProperty("identifierHash");
  });

  it("leaves the subject null for an unknown username and names a separate actor", () => {
    const event = toAdminAuthAuditEvent(
      createRow({
        userId: null,
        actorUserId: ADMIN_ID,
        eventType: "admin.audit_viewed",
        metadata: { view: "events" },
      }),
      usersById,
    );

    expect(event.subject).toBeNull();
    expect(event.actor).toEqual({
      id: ADMIN_ID,
      email: "admin@example.com",
      username: "admin",
    });
    expect(event.metadata).toEqual({ view: "events" });
  });

  it("treats a deleted account as unknown and an unrecognised stored value safely", () => {
    const event = toAdminAuthAuditEvent(
      createRow({
        userId: testUuid(9000, 376199),
        outcome: "weird",
        method: "carrier-pigeon",
        userAgent: null,
        metadata: ["not", "an", "object"],
      }),
      usersById,
    );

    expect(event).toMatchObject({
      subject: null,
      outcome: "failure",
      method: null,
      browser: null,
      os: null,
      metadata: null,
    });
  });

  it("does not repeat the subject as the actor when they acted on themselves", () => {
    expect(
      toAdminAuthAuditEvent(createRow({ actorUserId: USER_ID }), usersById)
        .actor,
    ).toBeNull();
  });
});
