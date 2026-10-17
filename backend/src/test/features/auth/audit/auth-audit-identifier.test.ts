import {
  hashAuthIdentifier,
  normalizeAuthIdentifier,
} from "@/features/auth/audit/auth-audit-identifier";

const SECRET = "test-auth-audit-identifier-secret-32";

describe("auth audit identifier hashing", () => {
  it("normalizes case, surrounding whitespace and unicode compatibility forms", () => {
    expect(normalizeAuthIdentifier("  Owner-One ")).toBe("owner-one");
    // A fullwidth "Ａ" is NFKC-equivalent to "a" once lowercased.
    expect(normalizeAuthIdentifier("Ａdmin")).toBe("admin");
  });

  it("is a stable 64-character hex HMAC of the normalized identifier", () => {
    const hash = hashAuthIdentifier("owner-one", SECRET);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAuthIdentifier("owner-one", SECRET)).toBe(hash);
    expect(hashAuthIdentifier(" OWNER-ONE", SECRET)).toBe(hash);
  });

  it("never contains the identifier and differs by identifier and secret", () => {
    const hash = hashAuthIdentifier("owner-one", SECRET);

    expect(hash).not.toContain("owner-one");
    expect(hashAuthIdentifier("owner-two", SECRET)).not.toBe(hash);
    expect(
      hashAuthIdentifier("owner-one", "another-auth-audit-secret-value-32"),
    ).not.toBe(hash);
  });
});
