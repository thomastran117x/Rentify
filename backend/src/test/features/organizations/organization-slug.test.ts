import {
  ORGANIZATION_SLUG_MAX_LENGTH,
  RESERVED_ORGANIZATION_SLUGS,
  generateShortSlugSuffix,
  isReservedOrganizationSlug,
  looksLikeUuid,
  nextSlugCandidate,
  reservedNamespaceSlug,
  resolveUniqueSlug,
  slugify,
  withSuffix,
} from "@/features/organizations/organization-slug";

const ORG_OPTIONS = {
  maxLength: ORGANIZATION_SLUG_MAX_LENGTH,
  fallback: "organization",
};

describe("slugify", () => {
  it("lowercases and joins words with single hyphens", () => {
    expect(slugify("Harbor Rentals", ORG_OPTIONS)).toBe("harbor-rentals");
  });

  it("folds diacritics via NFKD rather than dropping the character", () => {
    // This is the behaviour a SQL REGEXP_REPLACE backfill cannot reproduce,
    // which is why the backfill runs through this function.
    expect(slugify("Café Rentals", ORG_OPTIONS)).toBe("cafe-rentals");
    expect(slugify("Ünïcodë Störe", ORG_OPTIONS)).toBe("unicode-store");
  });

  it("collapses runs of punctuation and trims stray hyphens", () => {
    expect(slugify("  ***Harbor -- Rentals!!!  ", ORG_OPTIONS)).toBe(
      "harbor-rentals",
    );
  });

  it("falls back when the source has no usable characters", () => {
    expect(slugify("!!!", ORG_OPTIONS)).toBe("organization");
    expect(slugify("", ORG_OPTIONS)).toBe("organization");
    expect(slugify("...", { maxLength: 200, fallback: "post" })).toBe("post");
  });

  it("truncates to maxLength without leaving a trailing hyphen", () => {
    const source = `${"a".repeat(159)} bbbb`;
    const slug = slugify(source, ORG_OPTIONS);

    expect(slug.length).toBeLessThanOrEqual(ORGANIZATION_SLUG_MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("withSuffix", () => {
  it("appends the suffix when there is room", () => {
    expect(withSuffix("harbor-rentals", "-2", 160)).toBe("harbor-rentals-2");
  });

  it("reserves space for the suffix instead of overflowing", () => {
    // The bug this guards: a base already at maxLength plus "-2" is
    // maxLength + 2 characters and fails to insert.
    const base = "a".repeat(160);

    expect(withSuffix(base, "-2", 160)).toHaveLength(160);
    expect(withSuffix(base, "-183", 160)).toHaveLength(160);
    expect(withSuffix(base, "-a7k2", 160)).toHaveLength(160);
  });

  it("keeps the suffix intact when truncating", () => {
    const base = "a".repeat(160);

    expect(withSuffix(base, "-183", 160).endsWith("-183")).toBe(true);
    expect(withSuffix(base, "-a7k2", 160).endsWith("-a7k2")).toBe(true);
  });

  it("does not leave a doubled hyphen where the base was cut", () => {
    const base = `${"a".repeat(157)}-bb`;

    expect(withSuffix(base, "-2", 160)).not.toContain("--");
  });
});

describe("nextSlugCandidate", () => {
  it("returns the bare base first, then numbered suffixes", () => {
    expect(nextSlugCandidate("harbor-rentals", 0, 160)).toBe("harbor-rentals");
    expect(nextSlugCandidate("harbor-rentals", 1, 160)).toBe(
      "harbor-rentals-2",
    );
    expect(nextSlugCandidate("harbor-rentals", 2, 160)).toBe(
      "harbor-rentals-3",
    );
  });

  it("never exceeds maxLength", () => {
    const base = "a".repeat(200);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect(nextSlugCandidate(base, attempt, 160).length).toBeLessThanOrEqual(
        160,
      );
    }
  });
});

describe("looksLikeUuid", () => {
  it("detects a UUID, which would otherwise shadow an id lookup", () => {
    expect(looksLikeUuid("00000000-0000-0000-1040-000000000001")).toBe(true);
    expect(looksLikeUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
  });

  it("does not flag ordinary slugs", () => {
    expect(looksLikeUuid("harbor-rentals")).toBe(false);
    expect(looksLikeUuid("00000000-0000-0000-1040")).toBe(false);
  });
});

describe("isReservedOrganizationSlug", () => {
  it("reserves the segments that shadow sibling routes", () => {
    expect(isReservedOrganizationSlug("invitations")).toBe(true);
    expect(isReservedOrganizationSlug("by-slug")).toBe(true);
  });

  it("reserves the generated id namespace so users cannot claim it", () => {
    expect(
      isReservedOrganizationSlug(
        reservedNamespaceSlug("00000000-0000-0000-1040-000000000001"),
      ),
    ).toBe(true);
  });

  it("allows ordinary slugs", () => {
    expect(isReservedOrganizationSlug("harbor-rentals")).toBe(false);
    expect(isReservedOrganizationSlug("organization-id-not-hex")).toBe(false);
  });
});

describe("reservedNamespaceSlug", () => {
  it("derives a unique slug from the organization id", () => {
    expect(reservedNamespaceSlug("00000000-0000-0000-1040-000000000005")).toBe(
      "organization-id-00000000000000001040000000000005",
    );
  });

  it("stays within the slug length limit", () => {
    expect(
      reservedNamespaceSlug("00000000-0000-0000-1040-000000000005").length,
    ).toBeLessThanOrEqual(ORGANIZATION_SLUG_MAX_LENGTH);
  });
});

describe("generateShortSlugSuffix", () => {
  it("produces a short lowercase hex disambiguator, not a timestamp", () => {
    const suffix = generateShortSlugSuffix();

    expect(suffix).toMatch(/^[a-f0-9]{6}$/);
    // A timestamp suffix would be 8+ digits and read as noise in a URL.
    expect(suffix).not.toMatch(/^\d{8,}$/);
  });
});

describe("resolveUniqueSlug", () => {
  const options = {
    maxLength: 160,
    maxAttempts: 5,
    buildFallback: (base: string) => `${base}-fallback`,
  };

  it("returns the base when it is free", async () => {
    const slug = await resolveUniqueSlug(
      "harbor-rentals",
      async () => false,
      options,
    );

    expect(slug).toBe("harbor-rentals");
  });

  it("advances to -2 and -3 as candidates are taken", async () => {
    const taken = new Set(["harbor-rentals"]);
    await expect(
      resolveUniqueSlug(
        "harbor-rentals",
        async (candidate) => taken.has(candidate),
        options,
      ),
    ).resolves.toBe("harbor-rentals-2");

    taken.add("harbor-rentals-2");
    await expect(
      resolveUniqueSlug(
        "harbor-rentals",
        async (candidate) => taken.has(candidate),
        options,
      ),
    ).resolves.toBe("harbor-rentals-3");
  });

  it("uses the caller's fallback when every attempt is taken", async () => {
    const slug = await resolveUniqueSlug(
      "harbor-rentals",
      async () => true,
      options,
    );

    expect(slug).toBe("harbor-rentals-fallback");
  });

  it("stops probing as soon as a candidate is free", async () => {
    const isTaken = jest.fn(async (candidate: string) =>
      candidate.endsWith("s"),
    );

    await resolveUniqueSlug("harbor-rentals", isTaken, options);

    expect(isTaken).toHaveBeenCalledTimes(2);
  });
});

describe("RESERVED_ORGANIZATION_SLUGS", () => {
  it("is exported as a set of lowercase slugs", () => {
    for (const slug of RESERVED_ORGANIZATION_SLUGS) {
      expect(slug).toBe(slug.toLowerCase());
    }
  });
});
