import { createCipheriv, randomBytes } from "node:crypto";
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
      secret: "TESTSECRET",
      uri: "otpauth://totp/Test%3Auser?secret=TESTSECRET&issuer=Test",
    }),
    verifyCode: jest.fn().mockReturnValue(true),
  } as unknown as jest.Mocked<TotpService>;

  const mfaTotpRepository = {
    findByUserId: jest.fn<Promise<UserMfaTotp | null>, [string]>().mockResolvedValue(null),
    createPending: jest.fn<Promise<UserMfaTotp>, [{ userId: string; secretEncrypted: string; expiresAt: Date }]>().mockResolvedValue(makeRecord()),
    replacePending: jest.fn<Promise<UserMfaTotp>, [string, { secretEncrypted: string; expiresAt: Date }]>().mockResolvedValue(makeRecord()),
    activate: jest.fn<Promise<UserMfaTotp>, [string, Date]>().mockResolvedValue(makeRecord({ status: "active" })),
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
      expect(result).toEqual({ secret: "TESTSECRET", uri: expect.any(String) });
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

      await service.beginEnrollment("user-id", "user@example.com");

      expect(mfaTotpRepository.replacePending).toHaveBeenCalledWith(
        "existing-id",
        expect.objectContaining({ expiresAt: expect.any(Date) }),
      );
      expect(mfaTotpRepository.createPending).not.toHaveBeenCalled();
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

    it("throws BadRequestError when the TOTP code is wrong", async () => {
      const { service, mfaTotpRepository, totpService } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(makeRecord());
      totpService.verifyCode.mockReturnValue(false);

      await expect(
        service.confirmEnrollment("user-id", "000000"),
      ).rejects.toMatchObject<Partial<BadRequestError>>({
        message: "Verification code is incorrect.",
      });

      expect(mfaTotpRepository.activate).not.toHaveBeenCalled();
    });
  });

  describe("verifyCode", () => {
    it("resolves when code is valid against the active record", async () => {
      const { service, mfaTotpRepository } = createMocks();
      mfaTotpRepository.findByUserId.mockResolvedValue(
        makeRecord({ status: "active" }),
      );

      await expect(service.verifyCode("user-id", "123456")).resolves.toBeUndefined();
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
      totpService.verifyCode.mockReturnValue(false);

      await expect(
        service.verifyCode("user-id", "000000"),
      ).rejects.toMatchObject<Partial<UnauthorizedError>>({
        message: "MFA verification failed.",
      });
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
    it("stores and retrieves secrets without data loss (integration-style)", async () => {
      // This test uses real AES-256-GCM encryption instead of mocks to verify
      // that the encrypt/decrypt round-trip inside MfaTotpService is correct.
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

      // Step 1: begin enrollment — stores encrypted secret
      await service.beginEnrollment("user-id", "user@example.com");

      expect(storedEncryptedSecret).toBeDefined();
      expect(storedEncryptedSecret).not.toContain("TESTSECRET");

      // Step 2: confirm enrollment — decrypts and verifies
      await service.confirmEnrollment("user-id", "123456");

      // The decrypted secret should have been passed to verifyCode
      expect(totpService.verifyCode).toHaveBeenCalledWith(TEST_PLAIN_SECRET, "123456");
    });
  });
});
