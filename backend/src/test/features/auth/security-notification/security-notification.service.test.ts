import { asUuid } from "@/configuration/validation/uuid";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import { RECOVERY_CODE_COUNT } from "@/features/auth/mfa/recovery/mfa-recovery-code.model";
import {
  SECURITY_EMAIL_COUNT_SCRIPT,
  SECURITY_EMAIL_LIMIT,
  SECURITY_EMAIL_LIMIT_WINDOW_SECONDS,
  SecurityNotificationService,
} from "@/features/auth/security-notification/security-notification.service";

const USER_ID = asUuid("00000000-0000-4000-8000-000000460001");
const EVENT_ID = asUuid("00000000-0000-4000-8000-000000460002");
const BCRYPT_HASH = `$2b$10$${"a".repeat(53)}`;
const NOW = new Date("2026-11-04T10:15:00.000Z");
const CHROME_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function createUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: USER_ID,
    email: "owner@example.com",
    firstName: "Avery",
    emailVerified: true,
    passwordHash: BCRYPT_HASH,
    ...overrides,
  } as AuthUserRecord;
}

function createHarness() {
  const usersRepository = {
    findUserById: jest.fn(async () => createUser() as AuthUserRecord | null),
  };
  const emailService = {
    sendSecurityChangeEmail: jest.fn(async () => undefined),
  };
  const cache = { eval: jest.fn(async () => 1 as unknown) };
  const selfLockTokenStore = { issue: jest.fn(async () => "lock-token") };
  const service = new SecurityNotificationService({
    usersRepository: usersRepository as never,
    emailService: emailService as never,
    cache: cache as never,
    selfLockTokenStore: selfLockTokenStore as never,
    now: () => NOW,
  });

  return { service, usersRepository, emailService, cache, selfLockTokenStore };
}

const MFA_CHANGE = {
  kind: "mfa_enabled",
  details: {},
  userId: USER_ID,
  eventId: EVENT_ID,
} as const;

describe("SecurityNotificationService", () => {
  it("queues the email with when, where and a lock link naming the event", async () => {
    const harness = createHarness();

    await expect(
      harness.service.notify({
        kind: "personal_access_token_created",
        details: { tokenName: "CI", scopes: ["mcp:read"], expiresAt: null },
        userId: USER_ID,
        eventId: EVENT_ID,
        context: { ipAddress: "203.0.113.7", userAgent: CHROME_ON_WINDOWS },
      }),
    ).resolves.toBe("sent");

    expect(harness.selfLockTokenStore.issue).toHaveBeenCalledWith({
      userId: USER_ID,
      sourceEventId: EVENT_ID,
    });
    expect(harness.emailService.sendSecurityChangeEmail).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.emailService.sendSecurityChangeEmail).toHaveBeenCalledWith(
      "personal_access_token_created",
      {
        to: "owner@example.com",
        firstName: "Avery",
        occurredAt: NOW.toISOString(),
        ipAddress: "203.0.113.7",
        device: "Chrome on Windows",
        selfLockToken: "lock-token",
        tokenName: "CI",
        scopes: ["mcp:read"],
        expiresAt: null,
      },
    );
  });

  it("omits what the request did not reveal", async () => {
    const harness = createHarness();

    await harness.service.notify(MFA_CHANGE);

    expect(harness.emailService.sendSecurityChangeEmail).toHaveBeenCalledWith(
      "mfa_enabled",
      {
        to: "owner@example.com",
        firstName: "Avery",
        occurredAt: NOW.toISOString(),
        selfLockToken: "lock-token",
      },
    );
  });

  it("gives a partial device label when only part of it is known", async () => {
    const harness = createHarness();

    await harness.service.notify({
      ...MFA_CHANGE,
      context: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });

    expect(harness.emailService.sendSecurityChangeEmail).toHaveBeenCalledWith(
      "mfa_enabled",
      expect.objectContaining({ device: "Windows" }),
    );
  });

  it("leaves the lock link out for an account that could not recover from a lock", async () => {
    const harness = createHarness();
    harness.usersRepository.findUserById.mockResolvedValue(
      createUser({ passwordHash: undefined }),
    );

    await expect(harness.service.notify(MFA_CHANGE)).resolves.toBe("sent");

    expect(harness.selfLockTokenStore.issue).not.toHaveBeenCalled();
    expect(harness.emailService.sendSecurityChangeEmail).toHaveBeenCalledWith(
      "mfa_enabled",
      expect.not.objectContaining({ selfLockToken: expect.anything() }),
    );
  });

  it("still sends the email when the lock token cannot be stored", async () => {
    const harness = createHarness();
    harness.selfLockTokenStore.issue.mockRejectedValue(new Error("Redis down"));

    await expect(harness.service.notify(MFA_CHANGE)).resolves.toBe("sent");

    expect(harness.emailService.sendSecurityChangeEmail).toHaveBeenCalledTimes(
      1,
    );
  });

  it("skips an account whose address was never verified", async () => {
    const harness = createHarness();
    harness.usersRepository.findUserById.mockResolvedValue(
      createUser({ emailVerified: false }),
    );

    await expect(harness.service.notify(MFA_CHANGE)).resolves.toBe("skipped");

    expect(harness.cache.eval).not.toHaveBeenCalled();
    expect(harness.emailService.sendSecurityChangeEmail).not.toHaveBeenCalled();
  });

  it("sends to a given recipient and judges that address, not the account's", async () => {
    const harness = createHarness();
    harness.usersRepository.findUserById.mockResolvedValue(
      createUser({ email: "new@example.com", emailVerified: true }),
    );

    await expect(
      harness.service.notify({
        kind: "email_changed",
        details: { newEmail: "n***@example.com" },
        userId: USER_ID,
        eventId: EVENT_ID,
        recipient: { email: "old@example.com", emailVerified: false },
      }),
    ).resolves.toBe("skipped");

    await expect(
      harness.service.notify({
        kind: "email_changed",
        details: { newEmail: "n***@example.com" },
        userId: USER_ID,
        eventId: EVENT_ID,
        recipient: { email: "old@example.com", emailVerified: true },
      }),
    ).resolves.toBe("sent");

    expect(harness.emailService.sendSecurityChangeEmail).toHaveBeenCalledWith(
      "email_changed",
      expect.objectContaining({
        to: "old@example.com",
        newEmail: "n***@example.com",
      }),
    );
  });

  describe("a revert link", () => {
    const EMAIL_CHANGE = {
      kind: "email_changed",
      details: { newEmail: "n***@example.com" },
      userId: USER_ID,
      eventId: EVENT_ID,
      recipient: { email: "old@example.com", emailVerified: true },
    } as const;

    it("goes in the email", async () => {
      const harness = createHarness();

      await harness.service.notify({
        ...EMAIL_CHANGE,
        issueRevertToken: async () => "revert-token",
      });

      expect(harness.emailService.sendSecurityChangeEmail).toHaveBeenCalledWith(
        "email_changed",
        expect.objectContaining({ revertToken: "revert-token" }),
      );
    });

    it("is left out when it could not be issued", async () => {
      const harness = createHarness();

      await expect(
        harness.service.notify({
          ...EMAIL_CHANGE,
          issueRevertToken: async () => undefined,
        }),
      ).resolves.toBe("sent");

      expect(harness.emailService.sendSecurityChangeEmail).toHaveBeenCalledWith(
        "email_changed",
        expect.not.objectContaining({ revertToken: expect.anything() }),
      );
    });

    it("is not issued for an email that will not go out, so holds nothing", async () => {
      const harness = createHarness();
      const issueRevertToken = jest.fn(async () => "revert-token");

      harness.cache.eval.mockResolvedValue(SECURITY_EMAIL_LIMIT + 1);
      await expect(
        harness.service.notify({ ...EMAIL_CHANGE, issueRevertToken }),
      ).resolves.toBe("suppressed");

      await expect(
        harness.service.notify({
          ...EMAIL_CHANGE,
          recipient: { email: "old@example.com", emailVerified: false },
          issueRevertToken,
        }),
      ).resolves.toBe("skipped");

      expect(issueRevertToken).not.toHaveBeenCalled();
    });
  });

  it("counts per kind and inbox, in one atomic step", async () => {
    const harness = createHarness();

    await harness.service.notify(MFA_CHANGE);
    await harness.service.notify({ ...MFA_CHANGE, kind: "mfa_disabled" });

    const [script, [enabledKey], args] = harness.cache.eval.mock
      .calls[0] as unknown as [string, string[], string[]];
    const [, [disabledKey]] = harness.cache.eval.mock.calls[1] as unknown as [
      string,
      string[],
    ];

    expect(script).toBe(SECURITY_EMAIL_COUNT_SCRIPT);
    expect(args).toEqual([String(SECURITY_EMAIL_LIMIT_WINDOW_SECONDS)]);
    expect(enabledKey).toMatch(
      /^auth:security-email:mfa_enabled:[a-f0-9]{64}$/,
    );
    expect(disabledKey).toMatch(/^auth:security-email:mfa_disabled:/);
    expect(enabledKey).not.toContain("owner@example.com");
  });

  it("lets every code of a set through, while other kinds keep the default", async () => {
    const harness = createHarness();
    harness.cache.eval.mockResolvedValue(RECOVERY_CODE_COUNT);

    await expect(
      harness.service.notify({
        ...MFA_CHANGE,
        kind: "mfa_recovery_code_used",
        details: { remaining: 0 },
      }),
    ).resolves.toBe("sent");
    await expect(harness.service.notify(MFA_CHANGE)).resolves.toBe(
      "suppressed",
    );

    harness.cache.eval.mockResolvedValue(RECOVERY_CODE_COUNT + 1);
    await expect(
      harness.service.notify({
        ...MFA_CHANGE,
        kind: "mfa_recovery_code_used",
        details: { remaining: 0 },
      }),
    ).resolves.toBe("suppressed");
  });

  it("uses the same counter however an address is cased", async () => {
    const harness = createHarness();

    await harness.service.notify(MFA_CHANGE);
    harness.usersRepository.findUserById.mockResolvedValue(
      createUser({ email: "Owner@Example.com" }),
    );
    await harness.service.notify(MFA_CHANGE);

    const keys = harness.cache.eval.mock.calls.map(
      (call) => (call as unknown as [string, string[]])[1][0],
    );

    expect(keys[0]).toBe(keys[1]);
  });

  it("sends up to the limit, then suppresses without minting a token", async () => {
    const harness = createHarness();

    harness.cache.eval.mockResolvedValue(SECURITY_EMAIL_LIMIT);
    await expect(harness.service.notify(MFA_CHANGE)).resolves.toBe("sent");

    harness.selfLockTokenStore.issue.mockClear();
    harness.emailService.sendSecurityChangeEmail.mockClear();
    harness.cache.eval.mockResolvedValue(SECURITY_EMAIL_LIMIT + 1);

    await expect(harness.service.notify(MFA_CHANGE)).resolves.toBe(
      "suppressed",
    );

    expect(harness.selfLockTokenStore.issue).not.toHaveBeenCalled();
    expect(harness.emailService.sendSecurityChangeEmail).not.toHaveBeenCalled();
  });

  it("sends anyway when the rate limit is unavailable", async () => {
    const harness = createHarness();
    harness.cache.eval.mockRejectedValue(new Error("Redis down"));

    await expect(harness.service.notify(MFA_CHANGE)).resolves.toBe("sent");

    expect(harness.emailService.sendSecurityChangeEmail).toHaveBeenCalledTimes(
      1,
    );
  });

  it("reports a queue failure instead of throwing it", async () => {
    const harness = createHarness();
    harness.emailService.sendSecurityChangeEmail.mockRejectedValue(
      new Error("RabbitMQ down"),
    );

    await expect(harness.service.notify(MFA_CHANGE)).resolves.toBe("failed");
  });

  it("reports a failed account lookup instead of throwing it", async () => {
    const harness = createHarness();
    harness.usersRepository.findUserById.mockRejectedValue(
      new Error("Database down"),
    );

    await expect(harness.service.notify(MFA_CHANGE)).resolves.toBe("failed");
  });

  it("reports an account that no longer exists", async () => {
    const harness = createHarness();
    harness.usersRepository.findUserById.mockResolvedValue(null);

    await expect(harness.service.notify(MFA_CHANGE)).resolves.toBe("failed");
  });
});
