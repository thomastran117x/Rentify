import { TokenRepository } from "@/features/auth/token/token.repository";

describe("TokenRepository", () => {
  it("finds session validation data and token versions", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({
        tokenVersion: 7,
        role: "admin",
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        tokenVersion: 9,
        role: "owner",
      });
    const repository = new TokenRepository({
      user: {
        findUnique,
      },
    } as any);

    await expect(
      repository.findSessionValidationByUserId("user-1"),
    ).resolves.toEqual({
      tokenVersion: 7,
      role: "admin",
    });
    await expect(
      repository.findSessionValidationByUserId("missing-user"),
    ).resolves.toBeNull();
    await expect(repository.findTokenVersionByUserId("user-2")).resolves.toBe(
      9,
    );
  });

  it("rotates the token version", async () => {
    const update = jest.fn(async () => ({
      tokenVersion: 12,
    }));
    const repository = new TokenRepository({
      user: {
        update,
      },
    } as any);

    await expect(repository.rotateTokenVersion("user-1")).resolves.toBe(12);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          tokenVersion: {
            increment: 1,
          },
        },
        select: {
          tokenVersion: true,
        },
      }),
    );
  });
});
