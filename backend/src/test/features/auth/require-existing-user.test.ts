import BadRequestError from "@/errors/http/bad-request.error";
import type { AuthRepository } from "@/features/auth/auth.repository";
import { requireExistingUser } from "@/features/auth/require-existing-user";

describe("requireExistingUser", () => {
  it("returns the loaded user", async () => {
    const user = { id: "user-1" };
    const authRepository = {
      findUserById: jest.fn().mockResolvedValue(user),
    } as unknown as AuthRepository;

    await expect(requireExistingUser(authRepository, "user-1")).resolves.toBe(
      user,
    );
    expect(authRepository.findUserById).toHaveBeenCalledWith("user-1");
  });

  it("throws when the token outlives the account row", async () => {
    const authRepository = {
      findUserById: jest.fn().mockResolvedValue(null),
    } as unknown as AuthRepository;

    await expect(
      requireExistingUser(authRepository, "user-gone"),
    ).rejects.toThrow(BadRequestError);
  });
});
