import BadRequestError from "@/errors/http/bad-request.error";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import { requireExistingUser } from "@/features/auth/require-existing-user";
import { testUuid } from "../../support/uuid";
const USER_GONE_ID = testUuid(9000, 132757);

const USER_1_ID = testUuid(9000, 994257);

describe("requireExistingUser", () => {
  it("returns the loaded user", async () => {
    const user = { id: USER_1_ID };
    const authRepository = {
      findUserById: jest.fn().mockResolvedValue(user),
    } as unknown as UsersRepository;

    await expect(requireExistingUser(authRepository, USER_1_ID)).resolves.toBe(
      user,
    );
    expect(authRepository.findUserById).toHaveBeenCalledWith(USER_1_ID);
  });

  it("throws when the token outlives the account row", async () => {
    const authRepository = {
      findUserById: jest.fn().mockResolvedValue(null),
    } as unknown as UsersRepository;

    await expect(
      requireExistingUser(authRepository, USER_GONE_ID),
    ).rejects.toThrow(BadRequestError);
  });
});
