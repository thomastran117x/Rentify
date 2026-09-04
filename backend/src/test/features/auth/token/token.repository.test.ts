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
      repository.findSessionValidationByUserId(USER_1_ID),
    ).resolves.toEqual({
      tokenVersion: 7,
      role: "admin",
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
});
