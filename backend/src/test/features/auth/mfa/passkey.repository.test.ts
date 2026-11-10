import { PasskeyRepository } from "@/features/auth/mfa/passkey/passkey.repository";
import { MAX_PASSKEYS_PER_USER } from "@/features/auth/mfa/passkey/passkey.model";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 465301);
const PASSKEY_ID = testUuid(9000, 465302);

const NEW_ROW = {
  id: PASSKEY_ID,
  userId: USER_ID,
  credentialId: Uint8Array.from([1, 2, 3]),
  publicKey: Uint8Array.from([4, 5, 6]),
  signCount: 7,
  transports: ["usb" as const],
  aaguid: "00000000-0000-0000-0000-000000000000",
  backedUp: false,
  deviceType: "single_device" as const,
  name: "Key",
};

function createPrismaMock() {
  const userWebAuthnCredential = {
    findMany: jest.fn(async () => []),
    findFirst: jest.fn(async (): Promise<unknown> => ({ id: PASSKEY_ID })),
    count: jest.fn(async () => 0),
    create: jest.fn(async (args: { data: unknown }) => args.data),
    updateMany: jest.fn(async () => ({ count: 1 })),
    deleteMany: jest.fn(async () => ({ count: 1 })),
  };
  const transaction = {
    userWebAuthnCredential,
    $queryRaw: jest.fn(async () => [{ id: USER_ID }]),
  };
  const $transaction = jest.fn(
    async (operation: (client: typeof transaction) => unknown) =>
      operation(transaction),
  );

  return { userWebAuthnCredential, transaction, $transaction };
}

function createRepository() {
  const prisma = createPrismaMock();
  return { prisma, repository: new PasskeyRepository(prisma as never) };
}

describe("PasskeyRepository", () => {
  it("lists an account's passkeys oldest first", async () => {
    const { prisma, repository } = createRepository();

    await repository.listByUserId(USER_ID);

    expect(prisma.userWebAuthnCredential.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  });

  it("scopes every lookup by account", async () => {
    const { prisma, repository } = createRepository();

    await repository.countByUserId(USER_ID);
    await repository.findForUser(USER_ID, PASSKEY_ID);
    await repository.findByCredentialIdForUser(USER_ID, NEW_ROW.credentialId);

    expect(prisma.userWebAuthnCredential.count).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(prisma.userWebAuthnCredential.findFirst).toHaveBeenNthCalledWith(1, {
      where: { userId: USER_ID, id: PASSKEY_ID },
    });
    expect(prisma.userWebAuthnCredential.findFirst).toHaveBeenNthCalledWith(2, {
      where: { userId: USER_ID, credentialId: NEW_ROW.credentialId },
    });
  });

  it("locks the account row, then inserts under the cap", async () => {
    const { prisma, repository } = createRepository();

    const result = await repository.createWithinCap(NEW_ROW);

    expect(prisma.transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(
      prisma.transaction.userWebAuthnCredential.create,
    ).toHaveBeenCalledWith({
      data: { ...NEW_ROW, signCount: 7n },
    });
    expect(result).toEqual({
      status: "created",
      row: { ...NEW_ROW, signCount: 7n },
    });
  });

  it("inserts nothing once the account is at the cap", async () => {
    const { prisma, repository } = createRepository();
    prisma.userWebAuthnCredential.count.mockResolvedValueOnce(
      MAX_PASSKEYS_PER_USER,
    );

    await expect(repository.createWithinCap(NEW_ROW)).resolves.toEqual({
      status: "limit_reached",
    });
    expect(prisma.userWebAuthnCredential.create).not.toHaveBeenCalled();
  });

  it("renames only the account's own passkey", async () => {
    const { prisma, repository } = createRepository();

    await expect(
      repository.rename(USER_ID, PASSKEY_ID, "New"),
    ).resolves.toEqual({ id: PASSKEY_ID });
    expect(prisma.userWebAuthnCredential.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: PASSKEY_ID },
      data: { name: "New" },
    });

    prisma.userWebAuthnCredential.updateMany.mockResolvedValueOnce({
      count: 0,
    });
    await expect(
      repository.rename(USER_ID, PASSKEY_ID, "New"),
    ).resolves.toBeNull();
  });

  it("returns the removed row, or null when there was none to remove", async () => {
    const { prisma, repository } = createRepository();

    await expect(
      repository.deleteForUser(USER_ID, PASSKEY_ID),
    ).resolves.toEqual({
      id: PASSKEY_ID,
    });
    expect(prisma.userWebAuthnCredential.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: PASSKEY_ID },
    });

    prisma.userWebAuthnCredential.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.deleteForUser(USER_ID, PASSKEY_ID),
    ).resolves.toBeNull();

    prisma.userWebAuthnCredential.deleteMany.mockResolvedValueOnce({
      count: 0,
    });
    await expect(
      repository.deleteForUser(USER_ID, PASSKEY_ID),
    ).resolves.toBeNull();
  });

  it("moves the counter only from the value it was checked against", async () => {
    const { prisma, repository } = createRepository();
    const usedAt = new Date("2026-11-10T10:00:00.000Z");

    await expect(
      repository.claimSignCount({
        id: PASSKEY_ID,
        expectedSignCount: 7n,
        signCount: 8,
        backedUp: true,
        usedAt,
      }),
    ).resolves.toBe(true);
    expect(prisma.userWebAuthnCredential.updateMany).toHaveBeenCalledWith({
      where: { id: PASSKEY_ID, signCount: 7n },
      data: { signCount: 8n, backedUp: true, lastUsedAt: usedAt },
    });

    prisma.userWebAuthnCredential.updateMany.mockResolvedValueOnce({
      count: 0,
    });
    await expect(
      repository.claimSignCount({
        id: PASSKEY_ID,
        expectedSignCount: 7n,
        signCount: 8,
        backedUp: true,
        usedAt,
      }),
    ).resolves.toBe(false);
  });
});
