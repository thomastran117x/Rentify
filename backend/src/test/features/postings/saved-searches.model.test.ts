import { publicSearchPostingsQuerySchema } from "@/features/postings/postings.model";
import {
  SAVED_SEARCH_SCAN_PAGE_SIZE,
  SAVED_SEARCH_SEEN_CAP,
  buildSavedSearchQueryString,
  collectSavedSearchMatchIds,
  canonicalizeSavedSearchParams,
  createSavedSearchSchema,
  deriveSavedSearchName,
  hashSavedSearchParams,
  savedSearchQueryParamsSchema,
  toSavedSearchMatchPreview,
  toSavedSearchRecord,
  toSearchPostingsInput,
  updateSavedSearchSchema,
  type SavedSearchQueryParams,
} from "@/features/postings/saved-searches/saved-searches.model";

function parseParams(input: Record<string, unknown>): SavedSearchQueryParams {
  return savedSearchQueryParamsSchema.parse(input);
}

describe("savedSearchQueryParamsSchema", () => {
  it("accepts the same filters the public search accepts", () => {
    // The saved-search shape is derived from the live search shape, so every
    // filter the endpoint takes must round-trip. A drift here means a visitor
    // can run a search they are not allowed to save.
    const searchKeys = Object.keys(
      publicSearchPostingsQuerySchema.parse({
        q: "kayak",
        family: "equipment",
      }),
    );
    const savedKeys = Object.keys(
      savedSearchQueryParamsSchema.parse({ q: "kayak", family: "equipment" }),
    );

    for (const key of searchKeys) {
      if (key === "page" || key === "pageSize" || key === "sort") {
        continue;
      }

      expect(savedKeys).toContain(key);
    }
  });

  it("rejects the presentation parameters the sweep chooses for itself", () => {
    expect(
      savedSearchQueryParamsSchema.safeParse({ q: "kayak", page: 2 }).success,
    ).toBe(false);
    expect(
      savedSearchQueryParamsSchema.safeParse({ q: "kayak", sort: "newest" })
        .success,
    ).toBe(false);
  });

  it("rejects a search with no filters at all", () => {
    const result = savedSearchQueryParamsSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it("requires start and end to be provided together", () => {
    expect(
      savedSearchQueryParamsSchema.safeParse({
        startAt: "2026-09-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("requires latitude and longitude to be provided together", () => {
    expect(
      savedSearchQueryParamsSchema.safeParse({ latitude: 10 }).success,
    ).toBe(false);
  });

  it("rejects a minimum price above the maximum", () => {
    expect(
      savedSearchQueryParamsSchema.safeParse({
        minDailyPrice: 90,
        maxDailyPrice: 40,
      }).success,
    ).toBe(false);
  });

  it("rejects an inverted or empty availability window", () => {
    // The live search enforces this in its service layer, not its query schema.
    // A saved search that parses but cannot execute would fail every sweep
    // without ever being marked invalidated.
    expect(
      savedSearchQueryParamsSchema.safeParse({
        startAt: "2026-09-05T00:00:00.000Z",
        endAt: "2026-09-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      savedSearchQueryParamsSchema.safeParse({
        startAt: "2026-09-01T00:00:00.000Z",
        endAt: "2026-09-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("accepts a well-ordered availability window", () => {
    expect(
      savedSearchQueryParamsSchema.safeParse({
        startAt: "2026-09-01T00:00:00.000Z",
        endAt: "2026-09-05T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects attribute filters without a family and subtype", () => {
    expect(
      savedSearchQueryParamsSchema.safeParse({
        q: "kayak",
        attributeFilters: [{ key: "seats", min: 2 }],
      }).success,
    ).toBe(false);
  });

  it("accepts attribute filters once a family and subtype are present", () => {
    expect(
      savedSearchQueryParamsSchema.safeParse({
        family: "vehicle",
        subtype: "car",
        attributeFilters: [{ key: "seats", min: 2 }],
      }).success,
    ).toBe(true);
  });
});

describe("canonicalizeSavedSearchParams", () => {
  it("orders keys and array members so form-fill order cannot matter", () => {
    const left = parseParams({ q: "kayak", tags: ["water", "boat"] });
    const right = parseParams({ tags: ["boat", "water"], q: "kayak" });

    expect(canonicalizeSavedSearchParams(left)).toEqual(
      canonicalizeSavedSearchParams(right),
    );
  });

  it("drops empty arrays so an absent filter and an empty one agree", () => {
    const canonical = canonicalizeSavedSearchParams(
      parseParams({ q: "kayak", tags: [] }),
    );

    expect(canonical).not.toHaveProperty("tags");
  });

  it("orders attribute filters independently of how they were listed", () => {
    const left = parseParams({
      family: "vehicle",
      subtype: "car",
      attributeFilters: [
        { key: "seats", min: 2 },
        { key: "colour", value: "red" },
      ],
    });
    const right = parseParams({
      family: "vehicle",
      subtype: "car",
      attributeFilters: [
        { key: "colour", value: "red" },
        { key: "seats", min: 2 },
      ],
    });

    expect(canonicalizeSavedSearchParams(left)).toEqual(
      canonicalizeSavedSearchParams(right),
    );
  });
});

describe("hashSavedSearchParams", () => {
  it("hashes equivalent searches identically", () => {
    expect(
      hashSavedSearchParams(parseParams({ q: "kayak", tags: ["a", "b"] })),
    ).toBe(
      hashSavedSearchParams(parseParams({ tags: ["b", "a"], q: "kayak" })),
    );
  });

  it("hashes different searches differently", () => {
    expect(hashSavedSearchParams(parseParams({ q: "kayak" }))).not.toBe(
      hashSavedSearchParams(parseParams({ q: "canoe" })),
    );
  });
});

describe("deriveSavedSearchName", () => {
  it("builds a label from the filters that identify the search", () => {
    expect(
      deriveSavedSearchName(
        parseParams({ q: "kayak", family: "equipment", maxDailyPrice: 60 }),
      ),
    ).toBe("kayak · Equipment · under $60/day");
  });

  it("falls back to a generic label when no filter has a natural name", () => {
    expect(
      deriveSavedSearchName(
        parseParams({
          startAt: "2026-09-01T00:00:00.000Z",
          endAt: "2026-09-05T00:00:00.000Z",
        }),
      ),
    ).toBe("All postings");
  });

  it("keeps the name within the column width", () => {
    const name = deriveSavedSearchName(parseParams({ q: "x".repeat(120) }));

    expect(name.length).toBeLessThanOrEqual(120);
  });
});

describe("toSearchPostingsInput", () => {
  it("maps stored filters onto the live search input", () => {
    const input = toSearchPostingsInput(
      parseParams({
        q: "kayak",
        organization: "Harbour Rentals",
        latitude: 10,
        longitude: 20,
        radiusKm: 5,
        startAt: "2026-09-01T00:00:00.000Z",
        endAt: "2026-09-05T00:00:00.000Z",
      }),
      2,
      50,
    );

    expect(input).toMatchObject({
      page: 2,
      pageSize: 50,
      sort: "newest",
      query: "kayak",
      organizationQuery: "Harbour Rentals",
      geo: { latitude: 10, longitude: 20, radiusKm: 5 },
      availabilityWindow: {
        startAt: "2026-09-01T00:00:00.000Z",
        endAt: "2026-09-05T00:00:00.000Z",
      },
    });
  });

  it("does not leak the raw query keys the search input does not use", () => {
    const input = toSearchPostingsInput(parseParams({ q: "kayak" }), 1, 20);

    expect(input).not.toHaveProperty("q");
    expect(input).not.toHaveProperty("latitude");
  });
});

describe("buildSavedSearchQueryString", () => {
  it("repeats array keys the way the search endpoint parses them", () => {
    const query = buildSavedSearchQueryString(
      parseParams({ q: "kayak", tags: ["boat", "water"] }),
    );

    expect(query).toContain("tags=boat");
    expect(query).toContain("tags=water");
  });

  it("re-expands attribute filters into their attr.* form", () => {
    const query = buildSavedSearchQueryString(
      parseParams({
        family: "vehicle",
        subtype: "car",
        attributeFilters: [{ key: "seats", min: 2, max: 5 }],
      }),
    );

    expect(query).toContain("attr.seats.min=2");
    expect(query).toContain("attr.seats.max=5");
  });
});

describe("collectSavedSearchMatchIds", () => {
  function pagedSearch(pages: string[][]) {
    return jest.fn(async (input: { page: number }) => ({
      postings: (pages[input.page - 1] ?? []).map((id) => ({ id })),
      pagination: { hasNextPage: input.page < pages.length },
    }));
  }

  it("pages past the first page of results", async () => {
    // Results come back newest-published-first, so an unpaused posting sits
    // wherever its original publish date puts it. Reading only page one would
    // silently never alert on the case this feature exists for.
    const search = pagedSearch([["a", "b"], ["c"]]);

    await expect(
      collectSavedSearchMatchIds(parseParams({ q: "kayak" }), search),
    ).resolves.toEqual(["a", "b", "c"]);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("stops as soon as a page reports no successor", async () => {
    const search = pagedSearch([["a"]]);

    await collectSavedSearchMatchIds(parseParams({ q: "kayak" }), search);

    expect(search).toHaveBeenCalledTimes(1);
  });

  it("bounds the scan at the retention cap rather than paging forever", async () => {
    const page = Array.from({ length: 50 }, (_, index) => `p${index}`);
    const search = jest.fn(async () => ({
      postings: page.map((id) => ({ id })),
      pagination: { hasNextPage: true },
    }));

    const ids = await collectSavedSearchMatchIds(
      parseParams({ q: "kayak" }),
      search,
    );

    expect(ids).toHaveLength(SAVED_SEARCH_SEEN_CAP);
    expect(search).toHaveBeenCalledTimes(SAVED_SEARCH_SEEN_CAP / page.length);
  });

  it("always asks for newest-first pages of the scan size", async () => {
    const search = pagedSearch([["a"]]);

    await collectSavedSearchMatchIds(parseParams({ q: "kayak" }), search);

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: SAVED_SEARCH_SCAN_PAGE_SIZE,
        sort: "newest",
      }),
    );
  });
});

describe("toSavedSearchRecord", () => {
  const row = {
    id: "search-1",
    name: "Kayaks",
    queryParams: { q: "kayak" },
    notifyFrequency: "instant" as const,
    newMatchCount: 3,
    lastCheckedAt: new Date("2026-08-25T09:00:00.000Z"),
    lastNotifiedAt: null,
    invalidatedAt: null,
    createdAt: new Date("2026-08-20T12:00:00.000Z"),
  };

  it("maps a stored row onto the API record", () => {
    expect(toSavedSearchRecord(row)).toEqual({
      id: "search-1",
      name: "Kayaks",
      queryParams: { q: "kayak" },
      notifyFrequency: "instant",
      newMatchCount: 3,
      lastCheckedAt: "2026-08-25T09:00:00.000Z",
      lastNotifiedAt: null,
      invalidated: false,
      createdAt: "2026-08-20T12:00:00.000Z",
    });
  });

  it("reports a row whose stored filters no longer parse as invalidated", () => {
    // The column is JSON, so a filter removed from the search contract leaves
    // rows behind that nothing can execute. They must still render.
    const record = toSavedSearchRecord({
      ...row,
      queryParams: { thisFilterNoLongerExists: true },
    });

    expect(record.invalidated).toBe(true);
    expect(record.queryParams).toEqual({});
  });

  it("reports an explicitly invalidated row even when the filters still parse", () => {
    expect(
      toSavedSearchRecord({
        ...row,
        invalidatedAt: new Date("2026-08-24T00:00:00.000Z"),
      }).invalidated,
    ).toBe(true);
  });
});

describe("toSavedSearchMatchPreview", () => {
  it("trims a posting down to what an alert email renders", () => {
    expect(
      toSavedSearchMatchPreview({
        id: "posting-1",
        name: "Sea kayak",
        pricing: { currency: "AUD", daily: { amount: 45 } },
        organization: { id: "org-1", name: "Harbour Rentals", slug: "harbour" },
      } as never),
    ).toEqual({
      id: "posting-1",
      name: "Sea kayak",
      dailyPrice: 45,
      currency: "AUD",
      organizationName: "Harbour Rentals",
    });
  });

  it("tolerates a posting with no organization summary", () => {
    expect(
      toSavedSearchMatchPreview({
        id: "posting-1",
        name: "Sea kayak",
        pricing: { currency: "AUD", daily: { amount: 45 } },
      } as never).organizationName,
    ).toBeNull();
  });
});

describe("createSavedSearchSchema", () => {
  it("defaults the frequency to instant", () => {
    expect(
      createSavedSearchSchema.parse({ queryParams: { q: "kayak" } })
        .notifyFrequency,
    ).toBe("instant");
  });

  it("rejects unknown properties", () => {
    expect(
      createSavedSearchSchema.safeParse({
        queryParams: { q: "kayak" },
        somethingElse: true,
      }).success,
    ).toBe(false);
  });
});

describe("updateSavedSearchSchema", () => {
  it("rejects an update that changes nothing", () => {
    expect(updateSavedSearchSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a frequency-only update", () => {
    expect(
      updateSavedSearchSchema.safeParse({ notifyFrequency: "off" }).success,
    ).toBe(true);
  });
});
