import { SavedPostingsRepository } from "@/features/postings/saved/saved-postings.repository";
import { testUuid } from "../../support/uuid";
const POSTING_1_ID = testUuid(9000, 254272);

const USER_1_ID = testUuid(9000, 994257);

describe("SavedPostingsRepository", () => {
  it("upserts on save so repeated saves keep the original createdAt", async () => {
    const createdAt = new Date("2026-08-01T12:00:00.000Z");
    const upsert = jest.fn(async () => ({ createdAt }));
    const repository = new SavedPostingsRepository({
      savedPosting: {
        upsert,
      },
    } as any);

    const result = await repository.save(USER_1_ID, POSTING_1_ID);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_postingId: {
            userId: USER_1_ID,
            postingId: POSTING_1_ID,
          },
        },
        create: expect.objectContaining({
          id: expect.any(String),
          userId: USER_1_ID,
          postingId: POSTING_1_ID,
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

    await expect(repository.unsave(USER_1_ID, POSTING_1_ID)).resolves.toBe(
      true,
    );
    await expect(repository.unsave(USER_1_ID, POSTING_1_ID)).resolves.toBe(
      false,
    );
    expect(deleteMany).toHaveBeenLastCalledWith({
      where: {
        userId: USER_1_ID,
        postingId: POSTING_1_ID,
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

    await expect(repository.findSavedAt(USER_1_ID, POSTING_1_ID)).resolves.toBe(
      createdAt,
    );
    await expect(
      repository.findSavedAt(USER_1_ID, POSTING_1_ID),
    ).resolves.toBeNull();
  });

  it("pages saved entries newest first with a stable tiebreak", async () => {
    const entries = [
      { postingId: "posting-2", createdAt: new Date("2026-08-02T00:00:00Z") },
      { postingId: POSTING_1_ID, createdAt: new Date("2026-08-01T00:00:00Z") },
    ];
    const findMany = jest.fn(async () => entries);
    const count = jest.fn(async () => 5);
    const repository = new SavedPostingsRepository({
      savedPosting: {
        findMany,
        count,
      },
    } as any);

    const result = await repository.listPage(USER_1_ID, 2, 2);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_1_ID },
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

    const result = await repository.listPage(USER_1_ID, 1, 20);

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
      { postingId: POSTING_1_ID },
    ]);
    const repository = new SavedPostingsRepository({
      savedPosting: {
        findMany,
      },
    } as any);

    const result = await repository.listIds(USER_1_ID, 10);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_1_ID },
        take: 10,
      }),
    );
    expect(result).toEqual(["posting-2", POSTING_1_ID]);
  });
});
