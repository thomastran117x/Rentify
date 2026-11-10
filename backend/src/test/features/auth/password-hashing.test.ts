import bcrypt from "bcrypt";
import { environment } from "@/configuration/environment";
import ConflictError from "@/errors/http/conflict.error";
import {
  DUMMY_PASSWORD_HASH,
  getBcryptCost,
  getDummyPasswordHash,
  needsRehash,
  rehashVerifiedPassword,
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

  it("rejects markup, as the request schema does", () => {
    expect(() => assertValidPassword("<b>tidal-harbor-lantern</b>")).toThrow(
      /unsupported HTML or script content/,
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

function withHashCost(hashCost: number) {
  const config = environment.getAuthSecurityConfig();

  return jest.spyOn(environment, "getAuthSecurityConfig").mockReturnValue({
    ...config,
    passwords: { ...config.passwords, hashCost },
  });
}

describe("getBcryptCost", () => {
  it("reads the cost from a bcrypt hash", () => {
    expect(getBcryptCost(DUMMY_PASSWORD_HASH)).toBe(12);
    expect(getBcryptCost("$2a$04$abcdefghijklmnopqrstuv")).toBe(4);
  });

  it("returns null for anything else", () => {
    expect(getBcryptCost("")).toBeNull();
    expect(getBcryptCost("plaintext")).toBeNull();
  });
});

describe("needsRehash", () => {
  afterEach(() => jest.restoreAllMocks());

  it("is true only below the configured cost", () => {
    withHashCost(12);

    expect(needsRehash("$2b$10$x")).toBe(true);
    expect(needsRehash("$2b$11$x")).toBe(true);
    expect(needsRehash("$2b$12$x")).toBe(false);
    // Lowering the cost never downgrades a stored hash.
    expect(needsRehash("$2b$13$x")).toBe(false);
    expect(needsRehash("not-bcrypt")).toBe(false);
  });

  it("follows the configured cost", () => {
    withHashCost(13);

    expect(needsRehash("$2b$12$x")).toBe(true);
  });
});

describe("rehashVerifiedPassword", () => {
  afterEach(() => jest.restoreAllMocks());

  it("rehashes a legacy password the new rules would refuse", async () => {
    withHashCost(10);
    const hash = await rehashVerifiedPassword("Rentify123!");

    expect(getBcryptCost(hash)).toBe(10);
    await expect(bcrypt.compare("Rentify123!", hash)).resolves.toBe(true);
  });
});

describe("hashPassword cost", () => {
  afterEach(() => jest.restoreAllMocks());

  it("hashes at the configured cost", async () => {
    withHashCost(10);

    expect(getBcryptCost(await hashPassword(STRONG_PASSWORD))).toBe(10);
  });
});

describe("getDummyPasswordHash", () => {
  afterEach(() => jest.restoreAllMocks());

  it("uses the fixed hash at the default cost", async () => {
    withHashCost(12);

    await expect(getDummyPasswordHash()).resolves.toBe(DUMMY_PASSWORD_HASH);
  });

  it("makes one at any other cost, once", async () => {
    withHashCost(10);

    const first = await getDummyPasswordHash();
    expect(getBcryptCost(first)).toBe(10);
    await expect(getDummyPasswordHash()).resolves.toBe(first);
    await expect(verifyPasswordAgainstFakeHash(STRONG_PASSWORD)).resolves.toBe(
      false,
    );
  });
});
