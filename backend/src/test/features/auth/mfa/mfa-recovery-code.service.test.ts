import { randomBytes } from "node:crypto";
import ConflictError from "@/errors/http/conflict.error";
import {
  formatRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
} from "@/features/auth/mfa/recovery/mfa-recovery-code.model";
import { MfaRecoveryCodeService } from "@/features/auth/mfa/recovery/mfa-recovery-code.service";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 464001);
const OTHER_USER_ID = testUuid(9000, 464002);
const CONTEXT = { requestId: "request-1", ipAddress: "127.0.0.1" };

function createHarness(hashKey = randomBytes(32)) {
  const repository = {
    claim: jest.fn(async () => true),
    countUnused: jest.fn(async () => 7),
    findSetCreatedAt: jest.fn<Promise<Date | null>, [string]>(async () => null),
    replaceForActiveTotp: jest.fn(async () => true),
  };
  const authAuditService = { recordSafely: jest.fn(async () => undefined) };
  const securityNotificationService = {
    notify: jest.fn(async (_input: { eventId: string }) => "sent"),
  };
  const service = new MfaRecoveryCodeService({
    mfaRecoveryCodeRepository: repository as never,
    hashKey,
    authAuditService: authAuditService as never,
    securityNotificationService: securityNotificationService as never,
  });

  return { service, repository, authAuditService, securityNotificationService };
}

describe("recovery code format", () => {
  it("has exactly 32 symbols, none of them easily misread", () => {
    expect(new Set(RECOVERY_CODE_ALPHABET).size).toBe(32);
    expect(RECOVERY_CODE_ALPHABET).not.toMatch(/[01IO]/);
  });

  it("forgives case, spaces and hyphens", () => {
    expect(normalizeRecoveryCode("abcde-fgh23")).toBe("ABCDEFGH23");
    expect(normalizeRecoveryCode(" ABCDE FGH23 ")).toBe("ABCDEFGH23");
    expect(normalizeRecoveryCode("ABCDEFGH23")).toBe("ABCDEFGH23");
  });

  it.each([
    ["too short", "ABCDE-FGH2"],
    ["too long", "ABCDE-FGH234"],
    ["outside the alphabet", "ABCDE-FGH01"],
    ["empty", ""],
    ["a six-digit code", "123456"],
  ])("rejects a code that is %s", (_label, value) => {
    expect(normalizeRecoveryCode(value)).toBeNull();
  });

  it("groups a code in two halves", () => {
    expect(formatRecoveryCode("ABCDEFGH23")).toBe("ABCDE-FGH23");
  });
});

describe("MfaRecoveryCodeService", () => {
  describe("generateSet", () => {
    it("makes a full set of distinct, valid codes without storing anything", () => {
      const { service, repository } = createHarness();

      const { codes, rows } = service.generateSet(USER_ID);

      expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
      expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
      for (const code of codes) {
        expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
        expect(normalizeRecoveryCode(code)).not.toBeNull();
      }
      expect(rows).toHaveLength(RECOVERY_CODE_COUNT);
      expect(repository.replaceForActiveTotp).not.toHaveBeenCalled();
    });

    it("stores a keyed hash, never the code", () => {
      const { service } = createHarness();

      const { codes, rows } = service.generateSet(USER_ID);

      for (const [index, row] of rows.entries()) {
        expect(row.userId).toBe(USER_ID);
        expect(row.codeHash).toMatch(/^[a-f0-9]{64}$/);
        expect(row.codeHash).not.toContain(
          normalizeRecoveryCode(codes[index]!)!.toLowerCase(),
        );
      }
    });
  });

  describe("getStatus", () => {
    it("reports the unused count and when the set was made", async () => {
      const { service, repository } = createHarness();
      repository.findSetCreatedAt.mockResolvedValue(
        new Date("2026-11-07T12:00:00.000Z"),
      );

      await expect(service.getStatus(USER_ID)).resolves.toEqual({
        remaining: 7,
        createdAt: "2026-11-07T12:00:00.000Z",
      });
    });

    it("has no date for an account that never had a set", async () => {
      const { service, repository } = createHarness();
      repository.countUnused.mockResolvedValue(0);

      await expect(service.getStatus(USER_ID)).resolves.toEqual({
        remaining: 0,
        createdAt: null,
      });
    });
  });

  describe("regenerate", () => {
    it("replaces the set, then audits and emails, pointing at one event", async () => {
      const {
        service,
        repository,
        authAuditService,
        securityNotificationService,
      } = createHarness();

      const result = await service.regenerate({
        userId: USER_ID,
        sessionId: "session-1",
        context: CONTEXT,
      });

      expect(result.codes).toHaveLength(RECOVERY_CODE_COUNT);
      expect(result.remaining).toBe(RECOVERY_CODE_COUNT);
      expect(repository.replaceForActiveTotp).toHaveBeenCalledTimes(1);
      expect(securityNotificationService.notify).toHaveBeenCalledWith({
        kind: "mfa_recovery_codes_regenerated",
        details: {},
        userId: USER_ID,
        eventId: expect.any(String),
        context: CONTEXT,
      });
      expect(authAuditService.recordSafely).toHaveBeenCalledWith({
        id: securityNotificationService.notify.mock.calls[0]![0].eventId,
        eventType: "mfa.recovery_codes_regenerated",
        outcome: "success",
        userId: USER_ID,
        sessionId: "session-1",
        context: CONTEXT,
        metadata: {
          remaining: RECOVERY_CODE_COUNT,
          emailNotification: "sent",
        },
      });
    });

    it("refuses an account with no active authenticator", async () => {
      const {
        service,
        repository,
        authAuditService,
        securityNotificationService,
      } = createHarness();
      repository.replaceForActiveTotp.mockResolvedValue(false);

      await expect(
        service.regenerate({ userId: USER_ID }),
      ).rejects.toBeInstanceOf(ConflictError);

      expect(securityNotificationService.notify).not.toHaveBeenCalled();
      expect(authAuditService.recordSafely).not.toHaveBeenCalled();
    });
  });

  it("hashes the same code differently per account and per key", () => {
    const key = randomBytes(32);
    const harness = createHarness(key);
    const hashOf = (
      service: MfaRecoveryCodeService,
      userId: typeof USER_ID,
    ): string =>
      (
        service as unknown as {
          hash(id: string, code: string): string;
        }
      ).hash(userId, "ABCDEFGH23");

    const base = hashOf(harness.service, USER_ID);

    expect(hashOf(harness.service, USER_ID)).toBe(base);
    expect(hashOf(harness.service, OTHER_USER_ID)).not.toBe(base);
    expect(hashOf(createHarness().service, USER_ID)).not.toBe(base);
  });
});
