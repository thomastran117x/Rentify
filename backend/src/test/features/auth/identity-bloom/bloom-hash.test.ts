import {
  getBitIndices,
  normalizeEmailForBloom,
  normalizeUsernameForBloom,
} from "@/features/auth/identity-bloom/bloom-hash";

describe("normalizeUsernameForBloom", () => {
  it("matches how the unique index stores usernames", () => {
    expect(normalizeUsernameForBloom("  Casey-Doe  ")).toBe("casey-doe");
    expect(normalizeUsernameForBloom("KATE")).toBe("kate");
  });

  it("collapses to an empty string for blank input", () => {
    expect(normalizeUsernameForBloom("   ")).toBe("");
  });
});

describe("normalizeEmailForBloom", () => {
  it("matches how the unique index stores emails", () => {
    // `users_email_key` sits on a utf8mb4_unicode_ci column, so the index
    // already treats these as one row; the filter has to agree.
    expect(normalizeEmailForBloom("  Casey@Example.COM  ")).toBe(
      "casey@example.com",
    );
  });

  it("leaves dots and plus tags alone", () => {
    // Collapsing them the way some providers do would make the filter claim a
    // value is present when the unique index says otherwise.
    expect(normalizeEmailForBloom("casey.doe+rent@example.com")).toBe(
      "casey.doe+rent@example.com",
    );
  });

  it("collapses to an empty string for blank input", () => {
    expect(normalizeEmailForBloom("   ")).toBe("");
  });
});

describe("getBitIndices", () => {
  it("hashes through the normalizer it is given", () => {
    // The subject's normalizer is what ties the filter to its unique index, so
    // two subjects can legitimately disagree about the same raw string.
    expect(
      getBitIndices("Casey@Example.com", 4_096, 5, normalizeEmailForBloom),
    ).toEqual(
      getBitIndices("casey@example.com", 4_096, 5, normalizeUsernameForBloom),
    );
  });

  it("is deterministic across calls", () => {
    expect(
      getBitIndices("casey-doe", 1_024, 7, normalizeUsernameForBloom),
    ).toEqual(getBitIndices("casey-doe", 1_024, 7, normalizeUsernameForBloom));
  });

  it("treats differently-cased spellings as the same name", () => {
    // A name added as `Kate` has to be found when checked as `kate`, or the
    // filter would report a taken username as definitely absent.
    expect(getBitIndices("Kate", 4_096, 5, normalizeUsernameForBloom)).toEqual(
      getBitIndices("  kate ", 4_096, 5, normalizeUsernameForBloom),
    );
  });

  it("returns exactly one index per requested probe", () => {
    expect(
      getBitIndices("casey", 4_096, 1, normalizeUsernameForBloom),
    ).toHaveLength(1);
    expect(
      getBitIndices("casey", 4_096, 7, normalizeUsernameForBloom),
    ).toHaveLength(7);
    expect(
      getBitIndices("casey", 4_096, 12, normalizeUsernameForBloom),
    ).toHaveLength(12);
  });

  it("keeps every index inside the bitmap", () => {
    const bitCount = 8_192;

    for (const name of ["a", "casey-doe", "z".repeat(50), "user.name_1"]) {
      for (const index of getBitIndices(
        name,
        bitCount,
        9,
        normalizeUsernameForBloom,
      )) {
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(bitCount);
      }
    }
  });

  it("spreads probes for one name across distinct positions", () => {
    // Double hashing with an odd step is what avoids every probe landing on the
    // same bit, which would silently collapse k hashes into one.
    const indices = getBitIndices(
      "casey-doe",
      1_000_003,
      7,
      normalizeUsernameForBloom,
    );

    expect(new Set(indices).size).toBe(7);
  });

  it("produces different positions for different names", () => {
    const first = getBitIndices(
      "casey-doe",
      1_000_003,
      7,
      normalizeUsernameForBloom,
    );
    const second = getBitIndices(
      "casey-doa",
      1_000_003,
      7,
      normalizeUsernameForBloom,
    );

    expect(first).not.toEqual(second);
  });

  it("distributes across the bitmap rather than clustering", () => {
    const bitCount = 100_003;
    const buckets = new Array<number>(10).fill(0);

    for (let index = 0; index < 5_000; index += 1) {
      const [first] = getBitIndices(
        `user-${index}`,
        bitCount,
        1,
        normalizeUsernameForBloom,
      );
      buckets[Math.floor((first! / bitCount) * 10)] += 1;
    }

    // Uniform would be 500 per bucket; a wide band still catches a hash that
    // piles everything into one region.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(300);
      expect(count).toBeLessThan(700);
    }
  });
});
