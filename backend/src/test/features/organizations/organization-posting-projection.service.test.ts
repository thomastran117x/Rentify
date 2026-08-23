import { OrganizationPostingProjectionService } from "@/features/organizations/organization-posting-projection.service";

function createService(overrides?: {
  postingsRepository?: Record<string, jest.Mock>;
  postingsPublicCacheService?: Record<string, jest.Mock>;
}) {
  const postingsRepository = {
    enqueueSearchSyncForOrganization: jest.fn(async () => [] as string[]),
    listPublicPostingIdsForOrganization: jest.fn(async () => [] as string[]),
    ...(overrides?.postingsRepository ?? {}),
  };
  const postingsPublicCacheService = {
    invalidatePublic: jest.fn(async () => 1),
    ...(overrides?.postingsPublicCacheService ?? {}),
  };

  return {
    service: new OrganizationPostingProjectionService(
      postingsRepository as any,
      postingsPublicCacheService as any,
    ),
    postingsRepository,
    postingsPublicCacheService,
  };
}

describe("OrganizationPostingProjectionService", () => {
  it("reindexes and re-caches the organization's postings when reindex is requested", async () => {
    const { service, postingsRepository, postingsPublicCacheService } =
      createService({
        postingsRepository: {
          enqueueSearchSyncForOrganization: jest.fn(async () => [
            "posting-1",
            "posting-2",
          ]),
        },
      });

    await service.cascade("org-1", { reindex: true });

    expect(
      postingsRepository.enqueueSearchSyncForOrganization,
    ).toHaveBeenCalledWith("org-1");
    // Invalidation is per key: the cache has no namespace-wide bump.
    expect(postingsPublicCacheService.invalidatePublic).toHaveBeenCalledWith(
      "posting-1",
    );
    expect(postingsPublicCacheService.invalidatePublic).toHaveBeenCalledWith(
      "posting-2",
    );
  });

  it("only refreshes the cache, without reindexing, when reindex is not requested", async () => {
    const { service, postingsRepository, postingsPublicCacheService } =
      createService({
        postingsRepository: {
          listPublicPostingIdsForOrganization: jest.fn(async () => [
            "posting-1",
          ]),
        },
      });

    await service.cascade("org-1", { reindex: false });

    expect(postingsPublicCacheService.invalidatePublic).toHaveBeenCalledWith(
      "posting-1",
    );
    expect(
      postingsRepository.enqueueSearchSyncForOrganization,
    ).not.toHaveBeenCalled();
  });

  it("does not throw when the cascade fails", async () => {
    const { service, postingsRepository } = createService({
      postingsRepository: {
        enqueueSearchSyncForOrganization: jest.fn(async () => {
          throw new Error("outbox unavailable");
        }),
      },
    });

    await expect(
      service.cascade("org-1", { reindex: true }),
    ).resolves.toBeUndefined();
    expect(
      postingsRepository.enqueueSearchSyncForOrganization,
    ).toHaveBeenCalled();
  });
});
