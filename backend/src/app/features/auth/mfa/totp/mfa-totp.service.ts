import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { MfaTotpRepository } from "./mfa-totp.repository";
import type { TotpService } from "./totp.service";

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const PENDING_TTL_MINUTES = 15;

interface MfaTotpServiceOptions {
  totpService: TotpService;
  mfaTotpRepository: MfaTotpRepository;
  encryptionKey: Buffer;
}

export class MfaTotpService {
  private readonly totpService: TotpService;
  private readonly mfaTotpRepository: MfaTotpRepository;
  private readonly encryptionKey: Buffer;

  constructor(options: MfaTotpServiceOptions) {
    this.totpService = options.totpService;
    this.mfaTotpRepository = options.mfaTotpRepository;
    this.encryptionKey = options.encryptionKey;
  }

  async beginEnrollment(
    userId: string,
    accountName: string,
  ): Promise<{ secret: string; uri: string }> {
    const existing = await this.mfaTotpRepository.findByUserId(userId);

    if (existing?.status === "active") {
      throw new ConflictError("MFA is already enabled.");
    }

    const { secret, uri } = this.totpService.generateSecret(accountName);
    const secretEncrypted = this.encrypt(secret);
    const expiresAt = new Date(Date.now() + PENDING_TTL_MINUTES * 60 * 1000);

    if (existing?.status === "pending") {
      const updated = await this.mfaTotpRepository.replacePending(existing.id, {
        secretEncrypted,
        expiresAt,
      });

      // The pending record was activated concurrently between our read and
      // this update — treat it the same as if we'd found an active record.
      if (updated === 0) {
        throw new ConflictError("MFA is already enabled.");
      }
    } else {
      try {
        await this.mfaTotpRepository.createPending({
          userId,
          secretEncrypted,
          expiresAt,
        });
      } catch (error) {
        // A concurrent request created a pending record between our read and
        // this insert (unique constraint on userId). Treat this as a retriable
        // condition — the client can re-call beginEnrollment to replace it.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new ConflictError(
            "MFA enrollment is already in progress. Please try again.",
          );
        }
        throw error;
      }
    }

    return { secret, uri };
  }

  async confirmEnrollment(userId: string, code: string): Promise<void> {
    const record = await this.mfaTotpRepository.findByUserId(userId);

    if (!record || record.status !== "pending") {
      throw new BadRequestError("No pending MFA setup found.");
    }

    // Treat null expiresAt as expired — every pending record must have an expiry.
    if (!record.expiresAt || record.expiresAt < new Date()) {
      throw new BadRequestError("MFA setup has expired. Please start over.");
    }

    const secret = this.decrypt(record.secretEncrypted);

    if (this.totpService.verifyCode(secret, code) === null) {
      throw new BadRequestError("Verification code is incorrect.");
    }

    await this.mfaTotpRepository.activate(record.id, new Date());
  }

  async verifyCode(userId: string, code: string): Promise<void> {
    const record = await this.mfaTotpRepository.findByUserId(userId);

    if (!record || record.status !== "active") {
      throw new UnauthorizedError("MFA verification failed.");
    }

    const secret = this.decrypt(record.secretEncrypted);
    const matchedCounter = this.totpService.verifyCode(secret, code);

    if (matchedCounter === null) {
      throw new UnauthorizedError("MFA verification failed.");
    }

    // Replay protection: reject any code whose counter is not strictly newer
    // than the last accepted one. lastUsedCounter is null for the first
    // verification after enrollment.
    const lastUsedCounter =
      record.lastUsedCounter !== null ? Number(record.lastUsedCounter) : -1;

    if (matchedCounter <= lastUsedCounter) {
      throw new UnauthorizedError("MFA verification failed.");
    }

    await this.mfaTotpRepository.updateLastUsedCounter(
      record.id,
      matchedCounter,
    );
  }

  async disable(userId: string): Promise<void> {
    await this.mfaTotpRepository.deleteByUserId(userId);
  }

  async isEnabled(userId: string): Promise<boolean> {
    const record = await this.mfaTotpRepository.findByUserId(userId);
    return record?.status === "active";
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]).toString("base64");
  }

  private decrypt(ciphertext: string): string {
    const data = Buffer.from(ciphertext, "base64");
    const iv = data.subarray(0, IV_BYTES);
    const authTag = data.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const encrypted = data.subarray(IV_BYTES + AUTH_TAG_BYTES);

    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  }
}
