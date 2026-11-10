import { PasswordRepository } from "@/features/auth/password/password.repository";
import { testUuid } from "../../../support/uuid";

const USER_1_ID = testUuid(9000, 994257);

describe("PasswordRepository", () => {
  it("writes a first password only while the account has none", async () => {
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const repository = new PasswordRepository({
      user: {
        updateMany,
      },
    } as any);

    await expect(
      repository.setPasswordHashIfUnset(USER_1_ID, "first-hash"),
    ).resolves.toBe(true);
    // A concurrent request already set one, so the conditional write matches
    // no rows and the caller must report a conflict.
    await expect(
      repository.setPasswordHashIfUnset(USER_1_ID, "second-hash"),
    ).resolves.toBe(false);

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: USER_1_ID,
        passwordHash: null,
      },
      data: {
        passwordHash: "first-hash",
      },
    });
  });

  it("replaces a hash only while it is still the one that was verified", async () => {
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const repository = new PasswordRepository({
      user: { updateMany },
    } as any);

    await expect(
      repository.replacePasswordHashIfUnchanged(USER_1_ID, "old", "rehashed"),
    ).resolves.toBe(true);
    // The password was changed in between: nothing is overwritten.
    await expect(
      repository.replacePasswordHashIfUnchanged(USER_1_ID, "old", "rehashed"),
    ).resolves.toBe(false);

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: USER_1_ID, passwordHash: "old" },
      data: { passwordHash: "rehashed" },
    });
  });

  it("updates a password hash unconditionally", async () => {
    const update = jest.fn(async () => undefined);
    const repository = new PasswordRepository({
      user: {
        update,
      },
    } as any);

    await repository.updatePasswordHash(USER_1_ID, "new-hash");

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          passwordHash: "new-hash",
        },
      }),
    );
  });
});
