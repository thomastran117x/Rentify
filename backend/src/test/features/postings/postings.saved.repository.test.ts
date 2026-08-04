import { SavedPostingsRepository } from "@/features/postings/saved/saved-postings.repository";

describe("SavedPostingsRepository", () => {
  it("upserts on save so repeated saves keep the original createdAt", async () => {
    const createdAt = new Date("2026-08-01T12:00:00.000Z");
    const upsert = jest.fn(async () => ({ createdAt }));
    const repository = new SavedPostingsRepository({
      savedPosting: {
        upsert,
      },
    } as any);

    const result = await repository.save("user-1", "posting-1");

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_postingId: {
            userId: "user-1",
            postingId: "posting-1",
          },
        },
        create: expect.objectContaining({
          id: expect.any(String),
          userId: "user-1",
          postingId: "posting-1",
        }),
        update: {},
      }),
    );
    expect(result).toEqual({ createdAt });
  });

  it("reports whether unsave removed a row", async () => {
    const deleteMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const repository = new SavedPostingsRepository({
      savedPosting: {
        deleteMany,
      },
    } as any);

    await expect(repository.unsave("user-1", "posting-1")).resolves.toBe(true);
    await expect(repository.unsave("user-1", "posting-1")).resolves.toBe(false);
    expect(deleteMany).toHaveBeenLastCalledWith({
      where: {
        userId: "user-1",
        postingId: "posting-1",
      },
    });
  });

  it("returns the save timestamp or null when nothing is saved", async () => {
    const createdAt = new Date("2026-08-01T12:00:00.000Z");
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ createdAt })
      .mockResolvedValueOnce(null);
    const repository = new SavedPostingsRepository({
      savedPosting: {
        findUnique,
      },
    } as any);

    await expect(repository.findSavedAt("user-1", "posting-1")).resolves.toBe(
      createdAt,
    );
    await expect(
      repository.findSavedAt("user-1", "posting-1"),
    ).resolves.toBeNull();
  });

  it("pages saved entries newest first with a stable tiebreak", async () => {
    const entries = [
      { postingId: "posting-2", createdAt: new Date("2026-08-02T00:00:00Z") },
      { postingId: "posting-1", createdAt: new Date("2026-08-01T00:00:00Z") },
    ];
    const findMany = jest.fn(async () => entries);
    const count = jest.fn(async () => 5);
    const repository = new SavedPostingsRepository({
      savedPosting: {
        findMany,
        count,
      },
    } as any);

    const result = await repository.listPage("user-1", 2, 2);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        skip: 2,
        take: 2,
        orderBy: [{ createdAt: "desc" }, { postingId: "asc" }],
      }),
    );
    expect(result).toEqual({
      entries,
      pagination: {
        page: 2,
        pageSize: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      },
    });
  });

  it("reports a single empty page when nothing is saved", async () => {
    const repository = new SavedPostingsRepository({
      savedPosting: {
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
      },
    } as any);

    const result = await repository.listPage("user-1", 1, 20);

    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  it("lists identifiers up to the requested limit", async () => {
    const findMany = jest.fn(async () => [
      { postingId: "posting-2" },
      { postingId: "posting-1" },
    ]);
    const repository = new SavedPostingsRepository({
      savedPosting: {
        findMany,
      },
    } as any);

    const result = await repository.listIds("user-1", 10);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        take: 10,
      }),
    );
    expect(result).toEqual(["posting-2", "posting-1"]);
  });
});
