import { RecommendationQueryService } from "@/features/recommendations/recommendation-query.service";

describe("RecommendationQueryService", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(new Date("2026-05-08T12:00:00.000Z").getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("serves fresh personalized snapshots for JWT sessions", async () => {
    const service = createService({
      getPersonalizationContext: jest.fn(async () => ({
        recommendationPersonalizationEnabled: true,
        profile: createProfile(),
        snapshot: createUserSnapshot("2026-05-08T10:00:00.000Z", [
          createCandidate("posting-1", ["matched_tag"]),
        ]),
      })),
      getPopularSnapshot: jest.fn(async () => null),
    });

    const result = await service.getRecommendations(createInput(), createJwtAuth());

    expect(result.mode).toBe("personalized");
    expect(result.fallback).toBe(false);
    expect(result.items).toEqual([
      expect.objectContaining({
        posting: expect.objectContaining({
          id: "posting-1",
        }),
        reasonCodes: ["matched_tag"],
      }),
    ]);
  });

  it("falls back to popular when the personalized snapshot is missing", async () => {
    const service = createService({
      getPersonalizationContext: jest.fn(async () => ({
        recommendationPersonalizationEnabled: true,
        profile: createProfile(),
        snapshot: null,
      })),
      getPopularSnapshot: jest.fn(async (segmentType: string) =>
        segmentType === "global"
          ? createPopularSnapshot("global", "global", "2026-05-08T09:00:00.000Z", [
              createCandidate("posting-2", ["popular"]),
            ])
          : null,
      ),
    });

    const result = await service.getRecommendations(createInput(), createJwtAuth());

    expect(result.mode).toBe("popular");
    expect(result.fallback).toBe(true);
    expect(result.fallbackReason).toBe("missing_snapshot");
    expect(result.items[0]?.posting.id).toBe("posting-2");
  });

  it("falls back to popular when the personalized profile is unqualified", async () => {
    const service = createService({
      getPersonalizationContext: jest.fn(async () => ({
        recommendationPersonalizationEnabled: true,
        profile: createProfile({
          qualified: false,
        }),
        snapshot: createUserSnapshot("2026-05-08T10:00:00.000Z", [
          createCandidate("posting-1", ["matched_family"]),
        ]),
      })),
      getPopularSnapshot: jest.fn(async (_segmentType: string, segmentValue: string) =>
        segmentValue === "global"
          ? createPopularSnapshot("global", "global", "2026-05-08T08:00:00.000Z", [
              createCandidate("posting-3", ["popular"]),
            ])
          : null,
      ),
    });

    const result = await service.getRecommendations(createInput(), createJwtAuth());

    expect(result.mode).toBe("popular");
    expect(result.fallbackReason).toBe("unqualified_profile");
    expect(result.items[0]?.posting.id).toBe("posting-3");
  });

  it("falls back to popular when the personalized snapshot is stale", async () => {
    const service = createService({
      getPersonalizationContext: jest.fn(async () => ({
        recommendationPersonalizationEnabled: true,
        profile: createProfile(),
        snapshot: createUserSnapshot("2026-05-07T09:00:00.000Z", [
          createCandidate("posting-stale-personalized", ["matched_family"]),
        ]),
      })),
      getPopularSnapshot: jest.fn(async (_segmentType: string, segmentValue: string) =>
        segmentValue === "global"
          ? createPopularSnapshot("global", "global", "2026-05-08T08:00:00.000Z", [
              createCandidate("posting-fresh-popular", ["popular"]),
            ])
          : null,
      ),
    });

    const result = await service.getRecommendations(createInput(), createJwtAuth());

    expect(result.mode).toBe("popular");
    expect(result.fallback).toBe(true);
    expect(result.fallbackReason).toBe("stale_snapshot");
    expect(result.items[0]?.posting.id).toBe("posting-fresh-popular");
  });

  it("serves popular without fallback when personalization is disabled", async () => {
    const service = createService({
      getPersonalizationContext: jest.fn(async () => ({
        recommendationPersonalizationEnabled: false,
        profile: createProfile(),
        snapshot: createUserSnapshot("2026-05-08T10:00:00.000Z", [
          createCandidate("posting-1", ["matched_tag"]),
        ]),
      })),
      getPopularSnapshot: jest.fn(async () =>
        createPopularSnapshot("global", "global", "2026-05-08T09:00:00.000Z", [
          createCandidate("posting-4", ["popular"]),
        ]),
      ),
    });

    const result = await service.getRecommendations(createInput(), createJwtAuth());

    expect(result.mode).toBe("popular");
    expect(result.fallback).toBe(false);
    expect(result.fallbackReason).toBeUndefined();
    expect(result.items[0]?.posting.id).toBe("posting-4");
  });

  it("serves popular for anonymous and PAT requests", async () => {
    const getPopularSnapshot = jest.fn(async () =>
      createPopularSnapshot("global", "global", "2026-05-08T09:00:00.000Z", [
        createCandidate("posting-5", ["popular"]),
      ]),
    );
    const service = createService({
      getPopularSnapshot,
    });

    const anonymousResult = await service.getRecommendations(createInput(), null);
    const patResult = await service.getRecommendations(createInput(), createPatAuth());

    expect(anonymousResult.mode).toBe("popular");
    expect(anonymousResult.fallback).toBe(false);
    expect(patResult.mode).toBe("popular");
    expect(patResult.fallback).toBe(false);
    expect(getPopularSnapshot).toHaveBeenCalled();
  });

  it("prefers family_subtype, then family, then global popular snapshots", async () => {
    const getPopularSnapshot = jest.fn(async (segmentType: string, segmentValue: string) => {
      if (segmentType === "family_subtype" && segmentValue === "vehicle:car") {
        return createPopularSnapshot(segmentType, segmentValue, "2026-05-08T10:00:00.000Z", [
          createCandidate("posting-6", ["popular"]),
        ]);
      }

      if (segmentType === "global") {
        return createPopularSnapshot("global", "global", "2026-05-08T09:00:00.000Z", [
          createCandidate("posting-global", ["popular"]),
        ]);
      }

      return null;
    });
    const service = createService({
      getPopularSnapshot,
    });

    const result = await service.getRecommendations(
      createInput({
        family: "vehicle",
        subtype: "car",
      }),
      null,
    );

    expect(getPopularSnapshot).toHaveBeenCalledWith("family_subtype", "vehicle:car");
    expect(result.items[0]?.posting.id).toBe("posting-6");
  });

  it("falls back to fresh global popular snapshots before stale preferred snapshots", async () => {
    const getPopularSnapshot = jest.fn(async (segmentType: string, segmentValue: string) => {
      if (segmentType === "family" && segmentValue === "vehicle") {
        return createPopularSnapshot(segmentType, segmentValue, "2026-05-08T01:00:00.000Z", [
          createCandidate("posting-stale-family", ["popular"]),
        ]);
      }

      if (segmentType === "global") {
        return createPopularSnapshot("global", "global", "2026-05-08T10:00:00.000Z", [
          createCandidate("posting-fresh-global", ["popular"]),
        ]);
      }

      return null;
    });
    const service = createService({
      getPopularSnapshot,
    });

    const result = await service.getRecommendations(
      createInput({
        family: "vehicle",
      }),
      null,
    );

    expect(result.items[0]?.posting.id).toBe("posting-fresh-global");
  });

  it("excludes own, active-booking, and confirmed-renting postings for authenticated users", async () => {
    const service = createService({
      getPersonalizationContext: jest.fn(async () => ({
        recommendationPersonalizationEnabled: true,
        profile: createProfile(),
        snapshot: createUserSnapshot("2026-05-08T10:00:00.000Z", [
          createCandidate("own-posting", ["matched_tag"]),
          createCandidate("active-booking-posting", ["matched_tag"]),
          createCandidate("confirmed-renting-posting", ["matched_tag"]),
          createCandidate("eligible-posting", ["matched_tag"]),
        ]),
      })),
      listExcludedPostingIdsForUser: jest.fn(async () =>
        new Set(["own-posting", "active-booking-posting", "confirmed-renting-posting"]),
      ),
    });

    const result = await service.getRecommendations(createInput(), createJwtAuth());

    expect(result.items.map((item) => item.posting.id)).toEqual(["eligible-posting"]);
  });

  it("applies availability, geo, and subtype filtering without re-ranking", async () => {
    const filterCandidateIdsByAvailabilityWindow = jest.fn(async (input: { candidateIds: string[] }) =>
      input.candidateIds.filter((id) => id !== "blocked-posting"),
    );
    const service = createService({
      getPopularSnapshot: jest.fn(async () =>
        createPopularSnapshot("global", "global", "2026-05-08T09:00:00.000Z", [
          createCandidate("blocked-posting", ["popular"]),
          createCandidate("far-posting", ["popular"]),
          createCandidate("wrong-subtype-posting", ["popular"]),
          createCandidate("eligible-posting", ["popular"]),
        ]),
      ),
      filterCandidateIdsByAvailabilityWindow,
      getPublicByIds: jest.fn(async (ids: string[]) => ({
        postings: ids.map((id) =>
          createPosting(id, {
            location:
              id === "far-posting"
                ? { latitude: 50, longitude: -100 }
                : { latitude: 43.7, longitude: -79.4 },
            variant:
              id === "wrong-subtype-posting"
                ? { family: "vehicle", subtype: "truck_van" }
                : { family: "vehicle", subtype: "car" },
          }),
        ),
        missingIds: [],
      })),
    });

    const result = await service.getRecommendations(
      createInput({
        family: "vehicle",
        subtype: "car",
        geo: {
          latitude: 43.7,
          longitude: -79.4,
          radiusKm: 50,
        },
        availabilityWindow: {
          startAt: "2026-05-09T00:00:00.000Z",
          endAt: "2026-05-10T00:00:00.000Z",
        },
      }),
      null,
    );

    expect(filterCandidateIdsByAvailabilityWindow).toHaveBeenCalledTimes(1);
    expect(result.items.map((item) => item.posting.id)).toEqual(["eligible-posting"]);
  });

  it("paginates after filtering while preserving stored candidate order", async () => {
    const service = createService({
      getPopularSnapshot: jest.fn(async () =>
        createPopularSnapshot("global", "global", "2026-05-08T09:00:00.000Z", [
          createCandidate("posting-1", ["popular"]),
          createCandidate("posting-2", ["popular"]),
          createCandidate("posting-3", ["popular"]),
        ]),
      ),
      getPublicByIds: jest.fn(async (ids: string[]) => ({
        postings: ids.map((id) => createPosting(id)),
        missingIds: [],
      })),
    });

    const result = await service.getRecommendations(
      createInput({
        page: 2,
        pageSize: 1,
      }),
      null,
    );

    expect(result.items.map((item) => item.posting.id)).toEqual(["posting-2"]);
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 1,
      total: 3,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });
});

function createService(overrides: Record<string, unknown>) {
  const repository = {
    getPersonalizationContext: jest.fn(async () => ({
      recommendationPersonalizationEnabled: true,
      profile: createProfile(),
      snapshot: createUserSnapshot("2026-05-08T10:00:00.000Z", []),
    })),
    getPopularSnapshot: jest.fn(async () => null),
    listExcludedPostingIdsForUser: jest.fn(async () => new Set<string>()),
    filterCandidateIdsByAvailabilityWindow: jest.fn(async (input: { candidateIds: string[] }) => input.candidateIds),
    ...overrides,
  };
  const postingsPublicCacheService = {
    getPublicByIds: jest.fn(async (ids: string[]) => ({
      postings: ids.map((id) => createPosting(id)),
      missingIds: [],
    })),
    ...(overrides.getPublicByIds ? { getPublicByIds: overrides.getPublicByIds } : {}),
  };

  return new RecommendationQueryService(repository as never, postingsPublicCacheService as never);
}

function createInput(overrides: Partial<Parameters<RecommendationQueryService["getRecommendations"]>[0]> = {}) {
  return {
    page: 1,
    pageSize: 20,
    family: undefined,
    subtype: undefined,
    geo: undefined,
    availabilityWindow: undefined,
    ...overrides,
  };
}

function createJwtAuth() {
  return {
    authMethod: "jwt" as const,
    sub: "user-1",
    email: "user@example.com",
    role: "renter" as const,
    deviceId: "device-1",
    iat: 1,
    exp: 9999999999,
  };
}

function createPatAuth() {
  return {
    authMethod: "pat" as const,
    sub: "user-1",
    scopes: ["mcp:read"],
    personalAccessTokenId: "pat-1",
    personalAccessTokenName: "test",
  };
}

function createProfile(overrides: Partial<{
  qualified: boolean;
}> = {}) {
  return {
    userId: "user-1",
    qualified: overrides.qualified ?? true,
    activityWindowStartAt: "2026-02-08T12:00:00.000Z",
    lastSignalAt: "2026-05-08T09:00:00.000Z",
    distinctPostingCount: 3,
    signalCounts: {
      posting_view: 2,
      search_click: 1,
      booking_request_created: 0,
      renting_confirmed: 0,
    },
    familyAffinities: [],
    subtypeAffinities: [],
    tagAffinities: [],
    rebuiltAt: "2026-05-08T10:00:00.000Z",
  };
}

function createUserSnapshot(generatedAt: string, candidates: Array<ReturnType<typeof createCandidate>>) {
  return {
    userId: "user-1",
    generatedAt,
    sourceLastSignalAt: generatedAt,
    candidateCount: candidates.length,
    candidates,
  };
}

function createPopularSnapshot(
  segmentType: "global" | "family" | "family_subtype",
  segmentValue: string,
  generatedAt: string,
  candidates: Array<ReturnType<typeof createCandidate>>,
) {
  return {
    segmentType,
    segmentValue,
    generatedAt,
    sourceLastSignalAt: generatedAt,
    candidateCount: candidates.length,
    candidates,
  };
}

function createCandidate(id: string, reasonCodes: string[]) {
  return {
    postingId: id,
    score: 1,
    reasonCodes,
  };
}

function createPosting(
  id: string,
  overrides?: Partial<{
    location: {
      latitude: number;
      longitude: number;
    };
    variant: {
      family: "place" | "equipment" | "vehicle";
      subtype: "entire_place" | "camera" | "car" | "truck_van";
    };
  }>,
) {
  return {
    id,
    ownerId: `owner-${id}`,
    status: "published" as const,
    variant: overrides?.variant ?? {
      family: "vehicle" as const,
      subtype: "car" as const,
    },
    name: id,
    description: id,
    pricing: {
      currency: "CAD",
      daily: {
        amount: 100,
      },
    },
    pricingCurrency: "CAD",
    photos: [],
    tags: [],
    details: {
      make: "Honda",
      model: "Civic",
      year: 2022,
      seats: 5,
      license_class: "G",
    },
    availabilityStatus: "available" as const,
    effectiveMaxBookingDurationDays: 30,
    availabilityBlocks: [],
    location: {
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
      postalCode: "M5V",
      latitude: overrides?.location?.latitude ?? 43.7,
      longitude: overrides?.location?.longitude ?? -79.4,
    },
    primaryPhotoUrl: undefined,
    primaryThumbnailUrl: undefined,
    createdAt: "2026-05-08T09:00:00.000Z",
    updatedAt: "2026-05-08T09:00:00.000Z",
    publishedAt: "2026-05-08T09:00:00.000Z",
  };
}
