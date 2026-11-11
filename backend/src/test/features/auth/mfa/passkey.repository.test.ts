import { PasskeyRepository } from "@/features/auth/mfa/passkey/passkey.repository";
import { MAX_PASSKEYS_PER_USER } from "@/features/auth/mfa/passkey/passkey.model";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 465301);
const PASSKEY_ID = testUuid(9000, 465302);
const CREATED_AT = new Date("2026-11-10T09:00:00.000Z");

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

const CODE_ROWS = [{ id: "code-1", userId: USER_ID, codeHash: "a".repeat(64) }];

function createPrismaMock() {
  const userWebAuthnCredential = {
    findMany: jest.fn(async () => []),
    findFirst: jest.fn(async (): Promise<unknown> => ({ id: PASSKEY_ID })),
    count: jest.fn(async () => 0),
    create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
      ...args.data,
      createdAt: CREATED_AT,
    })),
    updateMany: jest.fn(async () => ({ count: 1 })),
    deleteMany: jest.fn(async () => ({ count: 1 })),
  };
  const userMfaRecoveryCode = {
    count: jest.fn(async () => 0),
    createMany: jest.fn(async () => ({ count: 1 })),
    deleteMany: jest.fn(async () => ({ count: 10 })),
  };
  const userMfaTotp = {
    findFirst: jest.fn(async (): Promise<unknown> => null),
  };
  const transaction = {
    userWebAuthnCredential,
    userMfaRecoveryCode,
    userMfaTotp,
    $queryRaw: jest.fn(async () => [{ id: USER_ID }]),
  };
  const $transaction = jest.fn(
    async (operation: (client: typeof transaction) => unknown) =>
      operation(transaction),
  );

  return {
    userWebAuthnCredential,
    userMfaRecoveryCode,
    userMfaTotp,
    transaction,
    $transaction,
  };
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

  it("locks the account row, then inserts the passkey with a first set of codes", async () => {
    const { prisma, repository } = createRepository();

    const result = await repository.createWithinCap(NEW_ROW, CODE_ROWS);

    expect(
      prisma.transaction.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(
      prisma.userWebAuthnCredential.count.mock.invocationCallOrder[0]!,
    );
    expect(prisma.userWebAuthnCredential.create).toHaveBeenCalledWith({
      data: { ...NEW_ROW, signCount: 7n },
    });
    expect(prisma.userMfaRecoveryCode.count).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(prisma.userMfaRecoveryCode.createMany).toHaveBeenCalledWith({
      data: [{ ...CODE_ROWS[0], createdAt: CREATED_AT }],
    });
    expect(result).toEqual({
      status: "created",
      row: { ...NEW_ROW, signCount: 7n, createdAt: CREATED_AT },
      recoveryCodesIssued: true,
    });
  });

  it("keeps an account's existing codes, used up or not", async () => {
    const { prisma, repository } = createRepository();
    prisma.userMfaRecoveryCode.count.mockResolvedValueOnce(10);

    const result = await repository.createWithinCap(NEW_ROW, CODE_ROWS);

    expect(prisma.userMfaRecoveryCode.createMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ recoveryCodesIssued: false });
  });

  it("inserts nothing once the account is at the cap", async () => {
    const { prisma, repository } = createRepository();
    prisma.userWebAuthnCredential.count.mockResolvedValueOnce(
      MAX_PASSKEYS_PER_USER,
    );

    await expect(
      repository.createWithinCap(NEW_ROW, CODE_ROWS),
    ).resolves.toEqual({ status: "limit_reached" });
    expect(prisma.userWebAuthnCredential.create).not.toHaveBeenCalled();
    expect(prisma.userMfaRecoveryCode.createMany).not.toHaveBeenCalled();
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

  it("deletes the codes with the account's last strong factor", async () => {
    const { prisma, repository } = createRepository();

    await expect(
      repository.deleteForUser(USER_ID, PASSKEY_ID),
    ).resolves.toEqual({ row: { id: PASSKEY_ID }, lastStrongFactor: true });
    expect(prisma.transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.userWebAuthnCredential.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: PASSKEY_ID },
    });
    expect(prisma.userMfaRecoveryCode.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
  });

  it.each([
    ["another passkey", { passkeys: 1, totp: null }],
    ["an active authenticator", { passkeys: 0, totp: { id: "totp-1" } }],
  ])("keeps the codes while %s remains", async (_label, remaining) => {
    const { prisma, repository } = createRepository();
    prisma.userWebAuthnCredential.count.mockResolvedValueOnce(
      remaining.passkeys,
    );
    prisma.userMfaTotp.findFirst.mockResolvedValueOnce(remaining.totp);

    await expect(
      repository.deleteForUser(USER_ID, PASSKEY_ID),
    ).resolves.toMatchObject({ lastStrongFactor: false });
    expect(prisma.userMfaRecoveryCode.deleteMany).not.toHaveBeenCalled();
    expect(prisma.userMfaTotp.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, status: "active" },
      select: { id: true },
    });
  });

  it("removes nothing when the account has no such passkey", async () => {
    const { prisma, repository } = createRepository();
    prisma.userWebAuthnCredential.findFirst.mockResolvedValueOnce(null);

    await expect(
      repository.deleteForUser(USER_ID, PASSKEY_ID),
    ).resolves.toBeNull();
    expect(prisma.userWebAuthnCredential.deleteMany).not.toHaveBeenCalled();
    expect(prisma.userMfaRecoveryCode.deleteMany).not.toHaveBeenCalled();
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
