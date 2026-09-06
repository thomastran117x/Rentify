import { EmailBloomSource } from "@/features/auth/identity-bloom/sources/email-bloom.source";
import { UsernameBloomSource } from "@/features/auth/identity-bloom/sources/username-bloom.source";

function createRepository(findMany: jest.Mock): {
  repository: UsernameBloomSource;
  findMany: jest.Mock;
} {
  const repository = new UsernameBloomSource({
    profile: { findMany },
  } as never);

  return { repository, findMany };
}

describe("UsernameBloomSource", () => {
  it("selects only the columns the rebuild needs", async () => {
    const findMany = jest.fn(async () => [
      { id: "profile-1", username: "casey-doe" },
    ]);
    const { repository } = createRepository(findMany);

    await repository.listValuesAfter(null, 100);

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

    await repository.listValuesAfter("profile-8", 2);

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

    await expect(repository.listValuesAfter(null, 2)).resolves.toEqual({
      values: ["casey-doe", "river-stone"],
      nextCursorId: "profile-2",
    });
  });

  it("stops on a short page instead of making one more empty round trip", async () => {
    const findMany = jest.fn(async () => [
      { id: "profile-1", username: "casey-doe" },
    ]);
    const { repository } = createRepository(findMany);

    await expect(repository.listValuesAfter(null, 2)).resolves.toEqual({
      values: ["casey-doe"],
      nextCursorId: null,
    });
  });

  it("stops on an empty page", async () => {
    const findMany = jest.fn(async () => []);
    const { repository } = createRepository(findMany);

    await expect(repository.listValuesAfter("profile-9", 2)).resolves.toEqual({
      values: [],
      nextCursorId: null,
    });
  });
});

function createEmailSource(findMany: jest.Mock): EmailBloomSource {
  return new EmailBloomSource({
    user: { findMany },
  } as never);
}

describe("EmailBloomSource", () => {
  it("walks users rather than profiles", () => {
    // Emails live on the user row while usernames live on the profile, which is
    // the only thing separating the two sources.
    const findMany = jest.fn(async () => []);
    createEmailSource(findMany);

    expect(findMany).not.toHaveBeenCalled();
  });

  it("selects only the columns the rebuild needs", async () => {
    const findMany = jest.fn(async () => [
      { id: "user-1", email: "casey@example.com" },
    ]);

    await createEmailSource(findMany).listValuesAfter(null, 100);

    expect(findMany).toHaveBeenCalledWith({
      take: 100,
      orderBy: { id: "asc" },
      select: { id: true, email: true },
    });
  });

  it("pages by primary key rather than an offset", async () => {
    const findMany = jest.fn(async () => [
      { id: "user-9", email: "river@example.com" },
    ]);

    await createEmailSource(findMany).listValuesAfter("user-8", 2);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "user-8" },
        skip: 1,
      }),
    );
  });

  it("hands back a cursor while full pages keep arriving", async () => {
    const findMany = jest.fn(async () => [
      { id: "user-1", email: "casey@example.com" },
      { id: "user-2", email: "river@example.com" },
    ]);

    await expect(
      createEmailSource(findMany).listValuesAfter(null, 2),
    ).resolves.toEqual({
      values: ["casey@example.com", "river@example.com"],
      nextCursorId: "user-2",
    });
  });

  it("stops on a short page instead of making one more empty round trip", async () => {
    const findMany = jest.fn(async () => [
      { id: "user-1", email: "casey@example.com" },
    ]);

    await expect(
      createEmailSource(findMany).listValuesAfter(null, 2),
    ).resolves.toEqual({
      values: ["casey@example.com"],
      nextCursorId: null,
    });
  });

  it("stops on an empty page", async () => {
    const findMany = jest.fn(async () => []);

    await expect(
      createEmailSource(findMany).listValuesAfter("user-9", 2),
    ).resolves.toEqual({
      values: [],
      nextCursorId: null,
    });
  });
});
