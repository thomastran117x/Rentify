import type { RecordedAuthAuditEvent } from "@/features/auth/audit/auth-audit.model";
import { SuspiciousActivityDetector } from "@/features/auth/detection/suspicious-activity.detector";
import type { SuspiciousActivityDetectionConfig } from "@/features/auth/detection/suspicious-activity.model";
import {
  SLIDING_WINDOW_COUNT_SCRIPT,
  SLIDING_WINDOW_PEEK_SCRIPT,
} from "@/features/cache/sliding-window-counter";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 379001);
const OTHER_USER_ID = testUuid(9000, 379002);
const IP = "198.51.100.23";
const BCRYPT_HASH =
  "$2b$12$1M7NQyWNh5v3NFg4cTQdUeVUI5BvR9f0vAOVeI3E1FQfQ0rFJz0Vy";

let eventSequence = 0;

/**
 * A stand-in for the Redis sorted sets and claim keys the detector uses. The
 * window scripts are interpreted by identity, and `failNext` makes the next
 * call reject as an unreachable Redis would.
 */
class FakeDetectionCache {
  readonly windows = new Map<string, Map<string, number>>();
  readonly claims = new Set<string>();
  failNext = false;

  eval = jest.fn(
    async (script: string, keys: string[] = [], args: string[] = []) => {
      this.throwIfFailing();
      const [key] = keys;
      const now = Number(args[0]);
      const windowMs = Number(args[1]);
      const window = this.windows.get(key!) ?? new Map<string, number>();
      this.windows.set(key!, window);

      for (const [member, score] of window) {
        if (score <= now - windowMs) {
          window.delete(member);
        }
      }

      if (script === SLIDING_WINDOW_COUNT_SCRIPT) {
        window.set(args[2]!, now);
        return window.size;
      }

      if (script === SLIDING_WINDOW_PEEK_SCRIPT) {
        return window.size;
      }

      throw new Error("Unexpected script.");
    },
  );

  setIfNotExists = jest.fn(async (key: string) => {
    this.throwIfFailing();

    if (this.claims.has(key)) {
      return false;
    }

    this.claims.add(key);
    return true;
  });

  private throwIfFailing(): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Redis has not been initialized.");
    }
  }
}

function createConfig(
  overrides: Partial<SuspiciousActivityDetectionConfig> = {},
): SuspiciousActivityDetectionConfig {
  return {
    mode: "alert",
    repeatedLockouts: { enabled: true, threshold: 3, windowMinutes: 1440 },
    credentialStuffing: {
      enabled: true,
      threshold: 4,
      windowMinutes: 10,
      blockMinutes: 60,
    },
    successAfterFailures: { enabled: true, threshold: 5, windowMinutes: 60 },
    refreshReuse: { enabled: true, windowMinutes: 60 },
    ...overrides,
  };
}

function createUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "user@example.com",
    firstName: "Jane",
    passwordHash: BCRYPT_HASH,
    emailVerified: true,
    status: "active",
    ...overrides,
  };
}

function createDetector(
  config: SuspiciousActivityDetectionConfig = createConfig(),
  user: Record<string, unknown> | null = createUser(),
) {
  const cache = new FakeDetectionCache();
  const repository = {
    create: jest.fn(async () => undefined),
    findRecentEventIds: jest.fn(
      async (_input: { requestId?: string }): Promise<string[]> => [
        "related-1",
        "related-2",
      ],
    ),
    flagEvents: jest.fn(async (ids: readonly string[]) => ids.length),
  };
  const accountStatusService = {
    lock: jest.fn(async () => ({ changed: true }) as any),
  };
  const usersRepository = {
    findUserById: jest.fn(async () => user as any),
  };
  const emailService = {
    sendSuspiciousLoginEmail: jest.fn(async () => undefined),
  };
  const selfLockTokenStore = { issue: jest.fn(async () => "lock-token") };
  const ipBlockStore = {
    block: jest.fn(async (ipAddress: string) => ({
      ipAddress,
      expiresAt: "2026-10-26T13:00:00.000Z",
    })),
  };
  let now = new Date("2026-10-26T12:00:00.000Z");
  const detector = new SuspiciousActivityDetector({
    cache: cache as any,
    repository: repository as any,
    accountStatusService: accountStatusService as any,
    usersRepository: usersRepository as any,
    emailService,
    selfLockTokenStore,
    ipBlockStore: ipBlockStore as any,
    getConfig: () => config,
    now: () => now,
  });

  return {
    detector,
    cache,
    repository,
    accountStatusService,
    usersRepository,
    emailService,
    selfLockTokenStore,
    ipBlockStore,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

function event(
  overrides: Partial<RecordedAuthAuditEvent> = {},
): RecordedAuthAuditEvent {
  eventSequence += 1;

  return {
    id: testUuid(9100, 379000 + eventSequence),
    eventType: "login.failed",
    outcome: "failure",
    reasonCode: "bad_credentials",
    userId: USER_ID,
    identifierHash: "a".repeat(64),
    context: {
      ipAddress: IP,
      userAgent: "Mozilla/5.0",
      requestId: "request-1",
    },
    ...overrides,
  };
}

function lockout(overrides: Partial<RecordedAuthAuditEvent> = {}) {
  return event({
    eventType: "login.locked",
    outcome: "blocked",
    reasonCode: "locked",
    metadata: { triggered: true, failureReason: "bad_credentials" },
    ...overrides,
  });
}

function stuffingFailure(index: number) {
  return event({
    userId: null,
    identifierHash: index.toString(16).padStart(64, "0"),
  });
}

function suspiciousEvent(repository: { create: jest.Mock }) {
  return (repository.create.mock.calls as any[][])[0]?.[0];
}

describe("SuspiciousActivityDetector", () => {
  describe("mode gating", () => {
    it("does nothing at all in off mode", async () => {
      const { detector, cache, repository } = createDetector(
        createConfig({ mode: "off" }),
      );

      for (let index = 0; index < 5; index += 1) {
        await detector.handle(lockout());
      }

      expect(cache.eval).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("ignores events no rule watches, including its own", async () => {
      const { detector, cache } = createDetector();

      await detector.handle(event({ eventType: "logout" }));
      await detector.handle(event({ eventType: "device.new_detected" }));
      await detector.handle(
        event({ eventType: "security.suspicious_activity" }),
      );
      await detector.handle(event({ eventType: "account.locked" }));

      expect(cache.eval).not.toHaveBeenCalled();
    });
  });

  describe("rule (a): repeated lockouts", () => {
    it("does not fire below the threshold", async () => {
      const { detector, repository } = createDetector();

      await detector.handle(lockout());
      await detector.handle(lockout());

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("counts only the attempt that set the lock", async () => {
      const { detector, repository } = createDetector();

      for (let index = 0; index < 4; index += 1) {
        await detector.handle(lockout({ metadata: {} }));
      }

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("records and flags at the threshold but never locks in alert mode", async () => {
      const { detector, repository, accountStatusService, emailService } =
        createDetector();
      const third = lockout();

      await detector.handle(lockout());
      await detector.handle(lockout());
      await detector.handle(third);

      expect(accountStatusService.lock).not.toHaveBeenCalled();
      expect(emailService.sendSuspiciousLoginEmail).not.toHaveBeenCalled();
      expect(repository.findRecentEventIds).toHaveBeenCalledWith({
        userId: USER_ID,
        matches: [{ eventType: "login.locked", triggeredLockout: true }],
        createdFrom: new Date("2026-10-25T12:00:00.000Z"),
        limit: 50,
      });
      expect(suspiciousEvent(repository)).toMatchObject({
        eventType: "security.suspicious_activity",
        outcome: "failure",
        userId: USER_ID,
        flagged: true,
        context: { ipAddress: IP },
        metadata: {
          rule: "repeated_lockouts",
          mode: "alert",
          action: "none",
          windowSeconds: 86_400,
          count: 3,
          threshold: 3,
          relatedEventCount: 3,
          relatedEventIds: `${third.id},related-1,related-2`,
        },
      });
      expect(repository.flagEvents).toHaveBeenCalledWith([
        third.id,
        "related-1",
        "related-2",
      ]);
    });

    it("locks the account with source system in enforce mode", async () => {
      const { detector, repository, accountStatusService } = createDetector(
        createConfig({ mode: "enforce" }),
      );

      for (let index = 0; index < 3; index += 1) {
        await detector.handle(lockout());
      }

      const recorded = suspiciousEvent(repository);
      expect(accountStatusService.lock).toHaveBeenCalledWith(USER_ID, {
        reason: "Repeated sign-in lockouts",
        source: "system",
        context: expect.objectContaining({ ipAddress: IP }),
        metadata: { rule: "repeated_lockouts", sourceEventId: recorded.id },
      });
      expect(recorded).toMatchObject({
        outcome: "blocked",
        metadata: { action: "account_locked", mode: "enforce" },
      });
    });

    it.each(["locked", "suspended"])(
      "does not re-lock a %s account",
      async (status) => {
        const { detector, repository, accountStatusService } = createDetector(
          createConfig({ mode: "enforce" }),
          createUser({ status }),
        );

        for (let index = 0; index < 3; index += 1) {
          await detector.handle(lockout());
        }

        expect(accountStatusService.lock).not.toHaveBeenCalled();
        expect(suspiciousEvent(repository).metadata.action).toBe("skipped");
      },
    );

    it.each([
      ["has no password (provider sign-in only)", { passwordHash: null }],
      ["has an unverified email", { emailVerified: false }],
    ])(
      "never holds an account that %s, since it could not recover",
      async (_label, overrides) => {
        const { detector, repository, accountStatusService } = createDetector(
          createConfig({ mode: "enforce" }),
          createUser(overrides),
        );

        for (let index = 0; index < 3; index += 1) {
          await detector.handle(lockout());
        }

        expect(accountStatusService.lock).not.toHaveBeenCalled();
        expect(suspiciousEvent(repository)).toMatchObject({
          outcome: "failure",
          flagged: true,
          metadata: { action: "skipped" },
        });
      },
    );

    it("fires once per window, then again after it", async () => {
      const { detector, repository, cache, advance } = createDetector();

      for (let index = 0; index < 5; index += 1) {
        await detector.handle(lockout());
      }
      expect(repository.create).toHaveBeenCalledTimes(1);

      // The claim key expires with the window.
      advance(24 * 60 * 60 * 1000 + 1);
      cache.claims.clear();
      for (let index = 0; index < 3; index += 1) {
        await detector.handle(lockout());
      }

      expect(repository.create).toHaveBeenCalledTimes(2);
    });

    it("forgets lockouts that fall out of the window", async () => {
      const { detector, repository, advance } = createDetector();

      await detector.handle(lockout());
      await detector.handle(lockout());
      advance(24 * 60 * 60 * 1000 + 1);
      await detector.handle(lockout());

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("is skipped when disabled", async () => {
      const { detector, repository } = createDetector(
        createConfig({
          repeatedLockouts: {
            enabled: false,
            threshold: 1,
            windowMinutes: 1440,
          },
        }),
      );

      await detector.handle(lockout());

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("records the firing as failed when the lock throws", async () => {
      const { detector, repository, accountStatusService } = createDetector(
        createConfig({ mode: "enforce" }),
      );
      accountStatusService.lock.mockRejectedValueOnce(new Error("conflict"));

      for (let index = 0; index < 3; index += 1) {
        await detector.handle(lockout());
      }

      expect(suspiciousEvent(repository)).toMatchObject({
        outcome: "failure",
        metadata: { action: "failed" },
      });
      expect(repository.flagEvents).toHaveBeenCalled();
    });
  });

  describe("rule (b): credential stuffing", () => {
    it("does not fire below the threshold of distinct identifiers", async () => {
      const { detector, repository } = createDetector();

      for (let index = 0; index < 3; index += 1) {
        await detector.handle(stuffingFailure(index));
      }
      // The same identifier again is not a new one.
      await detector.handle(stuffingFailure(0));

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("flags at the threshold but never blocks in alert mode", async () => {
      const { detector, repository, ipBlockStore, accountStatusService } =
        createDetector();

      for (let index = 0; index < 4; index += 1) {
        await detector.handle(stuffingFailure(index));
      }

      expect(ipBlockStore.block).not.toHaveBeenCalled();
      expect(accountStatusService.lock).not.toHaveBeenCalled();
      expect(repository.findRecentEventIds).toHaveBeenCalledWith({
        ipAddress: IP,
        matches: [{ eventType: "login.failed", outcome: "failure" }],
        createdFrom: new Date("2026-10-26T11:50:00.000Z"),
        limit: 50,
      });
      expect(suspiciousEvent(repository)).toMatchObject({
        userId: null,
        outcome: "failure",
        metadata: {
          rule: "credential_stuffing",
          action: "none",
          count: 4,
          threshold: 4,
        },
      });
    });

    it("blocks the IP for the configured time in enforce mode and never locks", async () => {
      const { detector, repository, ipBlockStore, accountStatusService } =
        createDetector(createConfig({ mode: "enforce" }));

      for (let index = 0; index < 4; index += 1) {
        await detector.handle(stuffingFailure(index));
      }

      expect(ipBlockStore.block).toHaveBeenCalledWith(
        IP,
        3600,
        new Date("2026-10-26T12:00:00.000Z"),
      );
      expect(accountStatusService.lock).not.toHaveBeenCalled();
      expect(suspiciousEvent(repository)).toMatchObject({
        outcome: "blocked",
        metadata: { action: "ip_blocked" },
      });
    });

    it("counts each IP on its own", async () => {
      const { detector, repository } = createDetector();

      for (let index = 0; index < 4; index += 1) {
        await detector.handle(
          event({
            userId: null,
            identifierHash: index.toString(16).padStart(64, "0"),
            context: { ipAddress: `203.0.113.${index}` },
          }),
        );
      }

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("ignores blocked failures and failures without an IP or identifier", async () => {
      const { detector, cache } = createDetector();

      await detector.handle(
        event({ outcome: "blocked", reasonCode: "account_locked" }),
      );
      await detector.handle(event({ userId: null, context: {} }));
      await detector.handle(event({ userId: null, identifierHash: undefined }));

      expect(cache.eval).not.toHaveBeenCalled();
    });
  });

  describe("rule (c): success after failures", () => {
    async function failTimes(
      detector: SuspiciousActivityDetector,
      times: number,
    ) {
      for (let index = 0; index < times; index += 1) {
        await detector.handle(event({ identifierHash: undefined }));
      }
    }

    /** A completed sign-in; the repository mock reports a new device in it. */
    function signIn(overrides: Partial<RecordedAuthAuditEvent> = {}) {
      return event({
        eventType: "login.succeeded",
        outcome: "success",
        reasonCode: undefined,
        context: {
          ipAddress: "203.0.113.99",
          userAgent: "New Browser",
          requestId: "request-sign-in",
        },
        ...overrides,
      });
    }

    it("does not fire with fewer failures than the threshold", async () => {
      const { detector, repository, emailService } = createDetector();

      await failTimes(detector, 4);
      await detector.handle(signIn());

      expect(repository.create).not.toHaveBeenCalled();
      expect(emailService.sendSuspiciousLoginEmail).not.toHaveBeenCalled();
    });

    it("emails once, with a working lock link, at the threshold in alert mode", async () => {
      const { detector, repository, emailService, selfLockTokenStore } =
        createDetector();
      repository.findRecentEventIds.mockImplementation(
        async (input: { requestId?: string }) =>
          input.requestId ? ["new-device-event"] : ["related-1", "related-2"],
      );
      const success = signIn();

      await failTimes(detector, 5);
      await detector.handle(success);
      await detector.handle(signIn());

      const recorded = suspiciousEvent(repository);
      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(selfLockTokenStore.issue).toHaveBeenCalledWith({
        userId: USER_ID,
        sourceEventId: recorded.id,
      });
      expect(emailService.sendSuspiciousLoginEmail).toHaveBeenCalledTimes(1);
      expect(emailService.sendSuspiciousLoginEmail).toHaveBeenCalledWith({
        to: "user@example.com",
        firstName: "Jane",
        reason: "success_after_failures",
        ipAddress: "203.0.113.99",
        userAgent: "New Browser",
        detectedAt: new Date("2026-10-26T12:00:00.000Z"),
        selfLockToken: "lock-token",
      });
      expect(repository.findRecentEventIds).toHaveBeenCalledWith({
        userId: USER_ID,
        requestId: "request-sign-in",
        matches: [{ eventType: "device.new_detected" }],
        createdFrom: new Date("2026-10-26T11:00:00.000Z"),
        limit: 1,
      });
      expect(repository.findRecentEventIds).toHaveBeenCalledWith({
        userId: USER_ID,
        matches: [
          { eventType: "login.failed", outcome: "failure" },
          { eventType: "login.locked", triggeredLockout: true },
        ],
        createdFrom: new Date("2026-10-26T11:00:00.000Z"),
        limit: 50,
      });
      expect(repository.flagEvents).toHaveBeenCalledWith([
        success.id,
        "new-device-event",
        "related-1",
        "related-2",
      ]);
      expect(recorded).toMatchObject({
        outcome: "failure",
        metadata: {
          rule: "success_after_failures",
          action: "email_sent",
          count: 5,
        },
      });
    });

    it("also fires on a provider sign-in", async () => {
      const { detector, emailService } = createDetector();

      await failTimes(detector, 5);
      await detector.handle(
        signIn({ eventType: "oauth.login.succeeded", method: "google" }),
      );

      expect(emailService.sendSuspiciousLoginEmail).toHaveBeenCalledTimes(1);
    });

    it("does not fire when the sign-in recorded no new device", async () => {
      const { detector, repository, emailService } = createDetector();
      repository.findRecentEventIds.mockImplementation(
        async (input: { requestId?: string }) =>
          input.requestId ? [] : ["related-1"],
      );

      await failTimes(detector, 5);
      await detector.handle(signIn());

      expect(repository.create).not.toHaveBeenCalled();
      expect(emailService.sendSuspiciousLoginEmail).not.toHaveBeenCalled();
    });

    it("ignores a new device seen while refreshing a session", async () => {
      const { detector, repository, emailService } = createDetector();

      await failTimes(detector, 5);
      await detector.handle(
        event({ eventType: "device.new_detected", outcome: "success" }),
      );

      expect(repository.findRecentEventIds).not.toHaveBeenCalled();
      expect(emailService.sendSuspiciousLoginEmail).not.toHaveBeenCalled();
    });

    it("needs the request id to tie the sign-in to its new device", async () => {
      const { detector, repository, emailService } = createDetector();

      await failTimes(detector, 5);
      await detector.handle(signIn({ context: { ipAddress: "203.0.113.99" } }));

      expect(repository.findRecentEventIds).not.toHaveBeenCalled();
      expect(emailService.sendSuspiciousLoginEmail).not.toHaveBeenCalled();
    });

    it("counts the attempt that set a lock as a failure", async () => {
      const { detector, emailService } = createDetector();

      await failTimes(detector, 4);
      await detector.handle(lockout({ identifierHash: undefined }));
      await detector.handle(signIn());

      expect(emailService.sendSuspiciousLoginEmail).toHaveBeenCalledTimes(1);
    });

    it("keeps each account's failures apart", async () => {
      const { detector, emailService } = createDetector();

      await failTimes(detector, 5);
      await detector.handle(signIn({ userId: OTHER_USER_ID }));

      expect(emailService.sendSuspiciousLoginEmail).not.toHaveBeenCalled();
    });

    it("sends the email without a link to an account that cannot reset a password", async () => {
      const { detector, emailService, selfLockTokenStore } = createDetector(
        createConfig(),
        createUser({ passwordHash: null }),
      );

      await failTimes(detector, 5);
      await detector.handle(signIn());

      expect(selfLockTokenStore.issue).not.toHaveBeenCalled();
      expect(emailService.sendSuspiciousLoginEmail).toHaveBeenCalledWith(
        expect.not.objectContaining({ selfLockToken: expect.anything() }),
      );
    });

    it("skips the email for an account that no longer exists", async () => {
      const { detector, repository, emailService } = createDetector(
        createConfig(),
        null,
      );

      await failTimes(detector, 5);
      await detector.handle(signIn());

      expect(emailService.sendSuspiciousLoginEmail).not.toHaveBeenCalled();
      expect(suspiciousEvent(repository).metadata.action).toBe("skipped");
    });

    it("counts nothing when disabled", async () => {
      const { detector, cache } = createDetector(
        createConfig({
          successAfterFailures: {
            enabled: false,
            threshold: 1,
            windowMinutes: 60,
          },
          credentialStuffing: {
            enabled: false,
            threshold: 1,
            windowMinutes: 10,
            blockMinutes: 60,
          },
        }),
      );

      await failTimes(detector, 2);
      await detector.handle(signIn());

      expect(cache.eval).not.toHaveBeenCalled();
    });
  });

  describe("rule (d): refresh-token reuse", () => {
    it("emails on the first reuse, and once per window", async () => {
      const { detector, repository, emailService } = createDetector();
      const reuse = event({
        eventType: "session.refresh_reuse_detected",
        outcome: "blocked",
        method: "refresh",
      });

      await detector.handle(reuse);
      await detector.handle(
        event({ eventType: "session.refresh_reuse_detected" }),
      );

      expect(emailService.sendSuspiciousLoginEmail).toHaveBeenCalledTimes(1);
      expect(emailService.sendSuspiciousLoginEmail).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "refresh_reuse" }),
      );
      expect(repository.findRecentEventIds).not.toHaveBeenCalled();
      expect(repository.flagEvents).toHaveBeenCalledWith([reuse.id]);
      expect(suspiciousEvent(repository)).toMatchObject({
        metadata: {
          rule: "refresh_reuse",
          count: 1,
          threshold: 1,
          windowSeconds: 3600,
          relatedEventIds: reuse.id,
        },
      });
    });

    it("needs a user and the rule switched on", async () => {
      const { detector, repository } = createDetector(
        createConfig({ refreshReuse: { enabled: false, windowMinutes: 60 } }),
      );

      await detector.handle(
        event({ eventType: "session.refresh_reuse_detected" }),
      );

      const other = createDetector();
      await other.detector.handle(
        event({ eventType: "session.refresh_reuse_detected", userId: null }),
      );

      expect(repository.create).not.toHaveBeenCalled();
      expect(other.repository.create).not.toHaveBeenCalled();
    });
  });

  describe("failures", () => {
    it("skips detection when Redis fails, without throwing", async () => {
      const { detector, cache, repository } = createDetector();
      cache.failNext = true;

      await expect(detector.handle(lockout())).resolves.toBeUndefined();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("skips detection when the database fails, without throwing", async () => {
      const { detector, repository } = createDetector();
      repository.create.mockRejectedValueOnce(new Error("database down"));

      await expect(
        detector.handle(event({ eventType: "session.refresh_reuse_detected" })),
      ).resolves.toBeUndefined();
    });
  });
});
