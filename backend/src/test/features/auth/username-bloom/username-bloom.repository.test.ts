import { UsernameBloomRepository } from "@/features/auth/username-bloom/username-bloom.repository";

function createRepository(findMany: jest.Mock): {
  repository: UsernameBloomRepository;
  findMany: jest.Mock;
} {
  const repository = new UsernameBloomRepository({
    profile: { findMany },
  } as never);

  return { repository, findMany };
}

describe("UsernameBloomRepository", () => {
  it("selects only the columns the rebuild needs", async () => {
    const findMany = jest.fn(async () => [
      { id: "profile-1", username: "casey-doe" },
    ]);
    const { repository } = createRepository(findMany);

    await repository.listUsernamesAfter(null, 100);

    expect(findMany).toHaveBeenCalledWith({
      take: 100,
      orderBy: { id: "asc" },
      select: { id: true, username: true },
    });
  });

  it("pages by primary key rather than an offset", async () => {
    // Offset pagination makes the database walk and discard every earlier row,
    // which gets steadily worse the deeper the rebuild goes.
    const findMany = jest.fn(async () => [
      { id: "profile-9", username: "river-stone" },
    ]);
    const { repository } = createRepository(findMany);

    await repository.listUsernamesAfter("profile-8", 2);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "profile-8" },
        skip: 1,
      }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ skip: 0 }),
    );
  });

  it("hands back a cursor while full pages keep arriving", async () => {
    const findMany = jest.fn(async () => [
      { id: "profile-1", username: "casey-doe" },
      { id: "profile-2", username: "river-stone" },
    ]);
    const { repository } = createRepository(findMany);

    await expect(repository.listUsernamesAfter(null, 2)).resolves.toEqual({
      usernames: ["casey-doe", "river-stone"],
      nextCursorId: "profile-2",
    });
  });

  it("stops on a short page instead of making one more empty round trip", async () => {
    const findMany = jest.fn(async () => [
      { id: "profile-1", username: "casey-doe" },
    ]);
    const { repository } = createRepository(findMany);

    await expect(repository.listUsernamesAfter(null, 2)).resolves.toEqual({
      usernames: ["casey-doe"],
      nextCursorId: null,
    });
  });

  it("stops on an empty page", async () => {
    const findMany = jest.fn(async () => []);
    const { repository } = createRepository(findMany);

    await expect(
      repository.listUsernamesAfter("profile-9", 2),
    ).resolves.toEqual({
      usernames: [],
      nextCursorId: null,
    });
  });
});
