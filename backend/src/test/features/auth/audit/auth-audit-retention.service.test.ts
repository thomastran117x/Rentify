import { AuthAuditRetentionService } from "@/features/auth/audit/auth-audit-retention.service";

const NOW = new Date("2026-10-17T12:00:00.000Z");

function createRepository(batches: string[][], deletedCounts?: number[]) {
  const pending = [...batches];
  const counts = deletedCounts ? [...deletedCounts] : undefined;

  return {
    listIdsCreatedBefore: jest.fn(
      async (_cutoff: Date, _limit: number) => pending.shift() ?? [],
    ),
    deleteByIds: jest.fn(
      async (ids: string[], _cutoff: Date) => counts?.shift() ?? ids.length,
    ),
  };
}

function createService(repository: ReturnType<typeof createRepository>) {
  return new AuthAuditRetentionService(repository as any, () => NOW);
}

describe("AuthAuditRetentionService", () => {
  it("puts the cutoff the retention period before now", () => {
    const service = createService(createRepository([]));

    expect(service.computeCutoff(180)).toEqual(
      new Date("2026-04-20T12:00:00.000Z"),
    );
    expect(service.computeCutoff(1)).toEqual(
      new Date("2026-10-16T12:00:00.000Z"),
    );
  });

  it("reads the clock when no clock is injected", () => {
    const service = new AuthAuditRetentionService(createRepository([]) as any);
    const before = Date.now();

    const cutoff = service.computeCutoff(1).getTime();

    expect(cutoff).toBeGreaterThanOrEqual(before - 86_400_000);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 86_400_000);
  });

  it("deletes nothing when no row is past the cutoff", async () => {
    const repository = createRepository([]);

    const summary = await createService(repository).prune({
      retentionDays: 180,
      batchSize: 2,
    });

    expect(summary).toEqual({
      cutoff: new Date("2026-04-20T12:00:00.000Z"),
      deleted: 0,
      batches: 0,
    });
    expect(repository.deleteByIds).not.toHaveBeenCalled();
  });

  it("stops after a batch shorter than the batch size", async () => {
    const repository = createRepository([["a"]]);

    const summary = await createService(repository).prune({
      retentionDays: 180,
      batchSize: 2,
    });

    expect(summary).toMatchObject({ deleted: 1, batches: 1 });
    expect(repository.listIdsCreatedBefore).toHaveBeenCalledTimes(1);
  });

  it("keeps deleting full batches until none is left", async () => {
    const repository = createRepository([
      ["a", "b"],
      ["c", "d"],
    ]);

    const summary = await createService(repository).prune({
      retentionDays: 180,
      batchSize: 2,
    });

    expect(summary).toMatchObject({ deleted: 4, batches: 2 });
    expect(repository.listIdsCreatedBefore).toHaveBeenCalledTimes(3);

    const cutoff = new Date("2026-04-20T12:00:00.000Z");
    expect(repository.listIdsCreatedBefore).toHaveBeenNthCalledWith(
      1,
      cutoff,
      2,
    );
    expect(repository.deleteByIds).toHaveBeenNthCalledWith(
      1,
      ["a", "b"],
      cutoff,
    );
    expect(repository.deleteByIds).toHaveBeenNthCalledWith(
      2,
      ["c", "d"],
      cutoff,
    );
  });

  it("counts only the rows it deleted when another replica got there first", async () => {
    const repository = createRepository([["a", "b"], ["c"]], [0, 1]);

    const summary = await createService(repository).prune({
      retentionDays: 180,
      batchSize: 2,
    });

    expect(summary).toMatchObject({ deleted: 1, batches: 2 });
  });

  it("fails the run on a database error", async () => {
    const repository = createRepository([
      ["a", "b"],
      ["c", "d"],
    ]);
    repository.deleteByIds
      .mockResolvedValueOnce(2)
      .mockRejectedValueOnce(new Error("connection lost"));

    await expect(
      createService(repository).prune({ retentionDays: 180, batchSize: 2 }),
    ).rejects.toThrow("connection lost");
    expect(repository.deleteByIds).toHaveBeenCalledTimes(2);
  });
});
