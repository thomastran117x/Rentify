import { OrganizationsSearchService } from "@/features/organizations/search/organizations-search.service";

function createOutbox(overrides: Record<string, unknown> = {}) {
  return {
    id: "outbox-1",
    organizationId: "org-1",
    operation: "upsert",
    dedupeKey: "outbox-1",
    attempts: 0,
    publishAttempts: 0,
    availableAt: "2026-05-01T00:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function createDocument(id: string) {
  return {
    id,
    name: `Org ${id}`,
    description: null,
    city: null,
    region: null,
    country: null,
    postalCode: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function createHarness(options?: {
  outbox?: Record<string, unknown> | null;
  documents?: ReturnType<typeof createDocument>[];
}) {
  const repository = {
    getSearchOutboxById: jest.fn(async () =>
      options?.outbox === null ? null : createOutbox(options?.outbox),
    ),
    hasNewerSearchOutboxJob: jest.fn(async () => false),
    findByIdsForIndexing: jest.fn(async () => options?.documents ?? []),
    markSearchOutboxIndexed: jest.fn(async () => undefined),
    incrementSearchOutboxAttempt: jest.fn(async () => 1),
  };
  const indexService = {
    upsertDocument: jest.fn(async () => undefined),
    deleteDocument: jest.fn(async () => undefined),
  };
  const queueService = {
    publishRetryJob: jest.fn(async () => undefined),
    publishDeadLetterJob: jest.fn(async () => undefined),
  };

  const service = new OrganizationsSearchService(
    repository as never,
    indexService as never,
    queueService as never,
  );

  return { service, repository, indexService };
}

const payload = {
  outboxId: "outbox-1",
  eventId: "outbox-1",
  dedupeKey: "outbox-1",
  operation: "upsert" as const,
  jobType: "upsert" as const,
  postingId: "org-1",
  targetIndexScope: "live" as const,
  occurredAt: "2026-05-01T00:00:00.000Z",
  attempt: 0,
};

describe("OrganizationsSearchService.processIndexJob", () => {
  it("indexes the organization document for an upsert job", async () => {
    const { service, repository, indexService } = createHarness({
      documents: [createDocument("org-1")],
    });

    await service.processIndexJob(payload, 5);

    expect(indexService.upsertDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "org-1" }),
      undefined,
    );
    expect(indexService.deleteDocument).not.toHaveBeenCalled();
    expect(repository.markSearchOutboxIndexed).toHaveBeenCalledWith("outbox-1");
  });

  it("removes the document for a delete job", async () => {
    const { service, indexService, repository } = createHarness({
      outbox: { operation: "delete" },
    });

    await service.processIndexJob({ ...payload, operation: "delete" }, 5);

    expect(indexService.deleteDocument).toHaveBeenCalledWith("org-1", undefined);
    expect(indexService.upsertDocument).not.toHaveBeenCalled();
    expect(repository.markSearchOutboxIndexed).toHaveBeenCalledWith("outbox-1");
  });

  it("deletes the document when the organization no longer exists", async () => {
    const { service, indexService } = createHarness({ documents: [] });

    await service.processIndexJob(payload, 5);

    expect(indexService.deleteDocument).toHaveBeenCalledWith("org-1", undefined);
    expect(indexService.upsertDocument).not.toHaveBeenCalled();
  });

  it("skips jobs whose outbox row was already indexed", async () => {
    const { service, indexService, repository } = createHarness({
      outbox: { indexedAt: "2026-05-02T00:00:00.000Z" },
    });

    await service.processIndexJob(payload, 5);

    expect(indexService.upsertDocument).not.toHaveBeenCalled();
    expect(indexService.deleteDocument).not.toHaveBeenCalled();
    expect(repository.markSearchOutboxIndexed).not.toHaveBeenCalled();
  });
});
