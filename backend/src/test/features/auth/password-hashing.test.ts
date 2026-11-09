import ConflictError from "@/errors/http/conflict.error";
import {
  DUMMY_PASSWORD_HASH,
  assertValidPassword,
  hashPassword,
  isBcryptHash,
  rejectIfPasswordMatchesCurrent,
  verifyPassword,
  verifyPasswordAgainstFakeHash,
} from "@/features/auth/password-hashing";

const STRONG_PASSWORD = "tidal-harbor-lantern";

describe("isBcryptHash", () => {
  it.each(["$2a$12$abcdefghijklmnopqrstuv", "$2b$12$x", "$2y$10$x"])(
    "accepts the bcrypt prefix %s",
    (value) => {
      expect(isBcryptHash(value)).toBe(true);
    },
  );

  it.each(["", "plaintext", "$1$12$x", "$2b$x$x"])("rejects %s", (value) => {
    expect(isBcryptHash(value)).toBe(false);
  });
});

describe("assertValidPassword", () => {
  it("accepts a strong password", () => {
    expect(() => assertValidPassword(STRONG_PASSWORD)).not.toThrow();
  });

  it("accepts a long password with no character-class mix", () => {
    expect(() => assertValidPassword("all lowercase words")).not.toThrow();
  });

  it("rejects a password shorter than 12 characters", () => {
    expect(() => assertValidPassword("Rentify123!")).toThrow(
      /at least 12 characters/,
    );
  });

  it("rejects a password over 72 bytes", () => {
    expect(() => assertValidPassword("a".repeat(73))).toThrow(
      /at most 72 bytes/,
    );
  });
});

describe("hashPassword", () => {
  it("produces a bcrypt hash that verifies against the original", async () => {
    const passwordHash = await hashPassword(STRONG_PASSWORD);

    expect(isBcryptHash(passwordHash)).toBe(true);
    await expect(verifyPassword(STRONG_PASSWORD, passwordHash)).resolves.toBe(
      true,
    );
  }, 20_000);

  it("refuses to hash a weak password", async () => {
    await expect(hashPassword("weak")).rejects.toThrow(
      /at least 12 characters/,
    );
  });
});

describe("verifyPassword", () => {
  it("rejects a wrong password against a real hash", async () => {
    const passwordHash = await hashPassword(STRONG_PASSWORD);

    await expect(verifyPassword("Wrong123!", passwordHash)).resolves.toBe(
      false,
    );
  }, 20_000);

  it("falls back to the dummy hash when the stored value is not bcrypt", async () => {
    // Social-only and missing accounts have no usable hash. The comparison still
    // has to run so the response time does not reveal which case it was.
    await expect(verifyPassword(STRONG_PASSWORD, "")).resolves.toBe(false);
  }, 20_000);

  it("never matches against the dummy hash", async () => {
    await expect(verifyPasswordAgainstFakeHash(STRONG_PASSWORD)).resolves.toBe(
      false,
    );
    expect(isBcryptHash(DUMMY_PASSWORD_HASH)).toBe(true);
  }, 20_000);
});

describe("rejectIfPasswordMatchesCurrent", () => {
  it("throws when the new password equals the current one", async () => {
    const passwordHash = await hashPassword(STRONG_PASSWORD);

    await expect(
      rejectIfPasswordMatchesCurrent(STRONG_PASSWORD, passwordHash),
    ).rejects.toThrow(ConflictError);
  }, 20_000);

  it("passes when the new password differs", async () => {
    const passwordHash = await hashPassword(STRONG_PASSWORD);

    await expect(
      rejectIfPasswordMatchesCurrent("Different123!", passwordHash),
    ).resolves.toBeUndefined();
  }, 20_000);
});
