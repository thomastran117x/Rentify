import { TokenRepository } from "@/features/auth/token/token.repository";
import { testUuid } from "../../../support/uuid";
const MISSING_USER_ID = testUuid(9000, 791594);

const USER_1_ID = testUuid(9000, 994257);
const USER_2_ID = testUuid(9000, 994258);

describe("TokenRepository", () => {
  it("finds session validation data and token versions", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({
        tokenVersion: 7,
        role: "admin",
        status: "locked",
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        tokenVersion: 9,
        role: "owner",
        status: "active",
      });
    const repository = new TokenRepository({
      user: {
        findUnique,
      },
    } as any);

    await expect(
      repository.findSessionValidationByUserId(USER_1_ID),
    ).resolves.toEqual({
      tokenVersion: 7,
      role: "admin",
      status: "locked",
    });
    await expect(
      repository.findSessionValidationByUserId(MISSING_USER_ID),
    ).resolves.toBeNull();
    await expect(repository.findTokenVersionByUserId(USER_2_ID)).resolves.toBe(
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

    await expect(repository.rotateTokenVersion(USER_1_ID)).resolves.toBe(12);

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

  it("revokes active PATs and rotates the token version in one transaction", async () => {
    const tokenId = testUuid(9300, 1);
    const transaction = {
      personalAccessToken: {
        findMany: jest.fn(async () => [{ id: tokenId }]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      user: {
        update: jest.fn(async () => ({ tokenVersion: 13 })),
      },
    };
    const repository = new TokenRepository({
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as any);

    await expect(repository.revokeAllCredentials(USER_1_ID)).resolves.toEqual({
      tokenVersion: 13,
      revokedPersonalAccessTokenIds: [tokenId],
    });
    expect(transaction.personalAccessToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [tokenId] }, revokedAt: null },
      }),
    );
    expect(transaction.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_1_ID },
        data: { tokenVersion: { increment: 1 } },
      }),
    );
  });
});
