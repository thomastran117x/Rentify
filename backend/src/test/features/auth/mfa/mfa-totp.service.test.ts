import { createCipheriv, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { UserMfaTotp } from "@/features/auth/mfa/totp/mfa-totp.repository";
import { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import type { TotpService } from "@/features/auth/mfa/totp/totp.service";

const TEST_ENCRYPTION_KEY = randomBytes(32);
const TEST_PLAIN_SECRET = "TESTSECRET";

function encryptForTest(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", TEST_ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

const ENCRYPTED_TEST_SECRET = encryptForTest(TEST_PLAIN_SECRET);

function makeRecord(overrides: Partial<UserMfaTotp> = {}): UserMfaTotp {
  return {
    id: "record-id",
    userId: "user-id",
    secretEncrypted: ENCRYPTED_TEST_SECRET,
    status: "pending",
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    lastUsedCounter: null,
    confirmedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMocks() {
  const totpService: jest.Mocked<TotpService> = {
    generateSecret: jest.fn().mockReturnValue({
      secret: TEST_PLAIN_SECRET,
      uri: "otpauth://totp/Test%3Auser?secret=TESTSECRET&issuer=Test",
    }),
    // Returns a matched counter (number) by default — simulates a successful verify
    verifyCode: jest.fn().mockReturnValue(56374060),
  } as unknown as jest.Mocked<TotpService>;

  const mfaTotpRepository = {
    findByUserId: jest.fn<Promise<UserMfaTotp | null>, [string]>().mockResolvedValue(null),
    createPending: jest.fn<Promise<UserMfaTotp>, [{ userId: string; secretEncrypted: string; expiresAt: Date }]>().mockResolvedValue(makeRecord()),
    replacePending: jest.fn<Promise<number>, [string, { secretEncrypted: string; expiresAt: Date }]>().mockResolvedValue(1),
    activate: jest.fn<Promise<UserMfaTotp>, [string, Date]>().mockResolvedValue(makeRecord({ status: "active" })),
    updateLastUsedCounter: jest.fn<Promise<void>, [string, number]>().mockResolvedValue(undefined),
    deleteByUserId: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  };

  const service = new MfaTotpService({
    totpService,
    mfaTotpRepository: mfaTotpRepository as never,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  return { service, totpService, mfaTotpRepository };
}

describe("MfaTotpService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("beginEnrollment", () => {
    it("creates a pending record and returns secret + uri when no record exists", async () => {
      const { service, totpService, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(null);

      const result = await service.beginEnrollment("user-id", "user@example.com");

      expect(totpService.generateSecret).toHaveBeenCalledWith("user@example.com");
      expect(mfaTotpRepository.createPending).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-id" }),
      );
      expect(result).toEqual({ secret: TEST_PLAIN_SECRET, uri: expect.any(String) });
    });

    it("sets expiresAt approximately 15 minutes in the future", async () => {
      const { service, mfaTotpRepository } = createMocks();
      const before = Date.now();

      await service.beginEnrollment("user-id", "user@example.com");

      const { expiresAt } = mfaTotpRepository.createPending.mock.calls[0][0];
      const after = Date.now();

      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 14 * 60 * 1000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(after + 16 * 60 * 1000);
    });

    it("throws ConflictError if user already has an active TOTP record", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(
        makeRecord({ status: "active" }),
      );

      await expect(
        service.beginEnrollment("user-id", "user@example.com"),
      ).rejects.toMatchObject<Partial<ConflictError>>({
        message: "MFA is already enabled.",
      });

      expect(mfaTotpRepository.createPending).not.toHaveBeenCalled();
      expect(mfaTotpRepository.replacePending).not.toHaveBeenCalled();
    });

    it("replaces an existing pending record instead of creating a new one", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(makeRecord({ id: "existing-id" }));
      mfaTotpRepository.replacePending.mockResolvedValue(1);

      await service.beginEnrollment("user-id", "user@example.com");

      expect(mfaTotpRepository.replacePending).toHaveBeenCalledWith(
        "existing-id",
        expect.objectContaining({ expiresAt: expect.any(Date) }),
      );
      expect(mfaTotpRepository.createPending).not.toHaveBeenCalled();
    });

    it("throws ConflictError when replacePending returns 0 (record was concurrently activated)", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(makeRecord());
      mfaTotpRepository.replacePending.mockResolvedValue(0);

      await expect(
        service.beginEnrollment("user-id", "user@example.com"),
      ).rejects.toMatchObject<Partial<ConflictError>>({
        message: "MFA is already enabled.",
      });
    });

    it("throws ConflictError when createPending fails with a unique constraint (concurrent enrollment)", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(null);

      const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      });
      mfaTotpRepository.createPending.mockRejectedValue(p2002);

      await expect(
        service.beginEnrollment("user-id", "user@example.com"),
      ).rejects.toMatchObject<Partial<ConflictError>>({
        message: "MFA enrollment is already in progress. Please try again.",
      });
    });

    it("re-throws non-P2002 errors from createPending unchanged", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(null);
      mfaTotpRepository.createPending.mockRejectedValue(new Error("DB down"));

      await expect(
        service.beginEnrollment("user-id", "user@example.com"),
      ).rejects.toThrow("DB down");
    });
  });

  describe("confirmEnrollment", () => {
    it("activates the pending record when code is correct", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(makeRecord());

      await service.confirmEnrollment("user-id", "123456");

      expect(mfaTotpRepository.activate).toHaveBeenCalledWith(
        "record-id",
        expect.any(Date),
      );
    });

    it("throws BadRequestError when no pending record exists", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(null);

      await expect(
        service.confirmEnrollment("user-id", "123456"),
      ).rejects.toMatchObject<Partial<BadRequestError>>({
        message: "No pending MFA setup found.",
      });
    });

    it("throws BadRequestError when record status is active (not pending)", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(
        makeRecord({ status: "active" }),
      );

      await expect(
        service.confirmEnrollment("user-id", "123456"),
      ).rejects.toMatchObject<Partial<BadRequestError>>({
        message: "No pending MFA setup found.",
      });
    });

    it("throws BadRequestError when the pending record is expired", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(
        makeRecord({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.confirmEnrollment("user-id", "123456"),
      ).rejects.toMatchObject<Partial<BadRequestError>>({
        message: "MFA setup has expired. Please start over.",
      });

      expect(mfaTotpRepository.activate).not.toHaveBeenCalled();
    });

    it("throws BadRequestError when expiresAt is null (treats null as expired)", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(
        makeRecord({ expiresAt: null }),
      );

      await expect(
        service.confirmEnrollment("user-id", "123456"),
      ).rejects.toMatchObject<Partial<BadRequestError>>({
        message: "MFA setup has expired. Please start over.",
      });
    });

    it("throws BadRequestError when the TOTP code is wrong", async () => {
      const { service, mfaTotpRepository, totpService } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(makeRecord());
      totpService.verifyCode.mockReturnValue(null);

      await expect(
        service.confirmEnrollment("user-id", "000000"),
      ).rejects.toMatchObject<Partial<BadRequestError>>({
        message: "Verification code is incorrect.",
      });

      expect(mfaTotpRepository.activate).not.toHaveBeenCalled();
    });
  });

  describe("verifyCode", () => {
    it("resolves and persists the matched counter when code is valid", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(
        makeRecord({ status: "active", lastUsedCounter: null }),
      );

      await expect(service.verifyCode("user-id", "123456")).resolves.toBeUndefined();

      expect(mfaTotpRepository.updateLastUsedCounter).toHaveBeenCalledWith(
        "record-id",
        56374060,
      );
    });

    it("throws UnauthorizedError when no record exists", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(null);

      await expect(
        service.verifyCode("user-id", "123456"),
      ).rejects.toMatchObject<Partial<UnauthorizedError>>({
        message: "MFA verification failed.",
      });
    });

    it("throws UnauthorizedError when record status is pending (not active)", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(makeRecord({ status: "pending" }));

      await expect(
        service.verifyCode("user-id", "123456"),
      ).rejects.toMatchObject<Partial<UnauthorizedError>>({
        message: "MFA verification failed.",
      });
    });

    it("throws UnauthorizedError when the TOTP code is wrong", async () => {
      const { service, mfaTotpRepository, totpService } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(
        makeRecord({ status: "active" }),
      );
      totpService.verifyCode.mockReturnValue(null);

      await expect(
        service.verifyCode("user-id", "000000"),
      ).rejects.toMatchObject<Partial<UnauthorizedError>>({
        message: "MFA verification failed.",
      });

      expect(mfaTotpRepository.updateLastUsedCounter).not.toHaveBeenCalled();
    });

    it("throws UnauthorizedError when counter is not newer than lastUsedCounter (replay attack)", async () => {
      const { service, mfaTotpRepository, totpService } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(
        makeRecord({ status: "active", lastUsedCounter: BigInt(56374060) }),
      );
      // verifyCode returns the same counter that was already stored
      totpService.verifyCode.mockReturnValue(56374060);

      await expect(
        service.verifyCode("user-id", "123456"),
      ).rejects.toMatchObject<Partial<UnauthorizedError>>({
        message: "MFA verification failed.",
      });

      expect(mfaTotpRepository.updateLastUsedCounter).not.toHaveBeenCalled();
    });

    it("accepts a code from a newer counter even when lastUsedCounter is set", async () => {
      const { service, mfaTotpRepository, totpService } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(
        makeRecord({ status: "active", lastUsedCounter: BigInt(56374059) }),
      );
      totpService.verifyCode.mockReturnValue(56374060);

      await expect(service.verifyCode("user-id", "123456")).resolves.toBeUndefined();

      expect(mfaTotpRepository.updateLastUsedCounter).toHaveBeenCalledWith(
        "record-id",
        56374060,
      );
    });
  });

  describe("disable", () => {
    it("deletes the TOTP record for the user", async () => {
      const { service, mfaTotpRepository } = createMocks();

      await service.disable("user-id");

      expect(mfaTotpRepository.deleteByUserId).toHaveBeenCalledWith("user-id");
    });

    it("is idempotent — does not throw when no record exists", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.deleteByUserId.mockResolvedValue(undefined);

      await expect(service.disable("user-id")).resolves.toBeUndefined();
    });
  });

  describe("isEnabled", () => {
    it("returns true when the user has an active TOTP record", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(
        makeRecord({ status: "active" }),
      );

      expect(await service.isEnabled("user-id")).toBe(true);
    });

    it("returns false when the user has a pending record", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(makeRecord({ status: "pending" }));

      expect(await service.isEnabled("user-id")).toBe(false);
    });

    it("returns false when no record exists", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(null);

      expect(await service.isEnabled("user-id")).toBe(false);
    });
  });

  describe("secret encryption round-trip", () => {
    it("stores encrypted (not plaintext) secret and decrypts correctly on verify", async () => {
      const { service, mfaTotpRepository, totpService } = createMocks();

      let storedEncryptedSecret: string | undefined;

      mfaTotpRepository.createPending.mockImplementation(async (data) => {
        storedEncryptedSecret = data.secretEncrypted;
        return makeRecord({ secretEncrypted: data.secretEncrypted });
      });

      mfaTotpRepository.findByUserId.mockImplementation(async () =>
        storedEncryptedSecret
          ? makeRecord({ secretEncrypted: storedEncryptedSecret })
          : null,
      );

      await service.beginEnrollment("user-id", "user@example.com");

      expect(storedEncryptedSecret).toBeDefined();
      expect(storedEncryptedSecret).not.toContain(TEST_PLAIN_SECRET);

      await service.confirmEnrollment("user-id", "123456");

      expect(totpService.verifyCode).toHaveBeenCalledWith(TEST_PLAIN_SECRET, "123456");
    });
  });
});
