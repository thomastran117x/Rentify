import { EmailChangeRevertRepository } from "@/features/auth/email-change/email-change-revert.repository";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 460021);
const OTHER_USER_ID = testUuid(9000, 460022);
const EVENT_ID = testUuid(9000, 460023);
const NOW = new Date("2026-11-04T10:15:00.000Z");
const EXPIRES_AT = new Date("2026-11-11T10:15:00.000Z");

function createPrismaMock() {
  const emailChangeRevert = {
    create: jest.fn((args: unknown) => args),
    updateMany: jest.fn(async (args: unknown) => {
      void args;
      return { count: 1 };
    }),
    findUnique: jest.fn(async () => ({ id: "revert-1" })),
    findFirst: jest.fn(async () => null as { id: string } | null),
    deleteMany: jest.fn(async () => ({ count: 3 })),
  };
  const $transaction = jest.fn(async (operations: unknown[]) => operations);

  return { emailChangeRevert, $transaction };
}

function createRepository() {
  const prisma = createPrismaMock();

  return {
    prisma,
    repository: new EmailChangeRevertRepository(prisma as never),
  };
}

describe("EmailChangeRevertRepository", () => {
  it("retires the account's open links and adds the new one together", async () => {
    const { prisma, repository } = createRepository();

    await repository.replaceOpenForUser(
      {
        userId: USER_ID,
        tokenHash: "hash",
        oldEmail: " Old@Rentify.local ",
        newEmail: "NEW@rentify.local",
        sourceEventId: EVENT_ID,
        expiresAt: EXPIRES_AT,
      },
      NOW,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.emailChangeRevert.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, consumedAt: null },
      data: { consumedAt: NOW },
    });
    expect(prisma.emailChangeRevert.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        userId: USER_ID,
        tokenHash: "hash",
        oldEmail: "old@rentify.local",
        newEmail: "new@rentify.local",
        sourceEventId: EVENT_ID,
        expiresAt: EXPIRES_AT,
      },
    });
  });

  it("claims only an unused, unexpired link", async () => {
    const { prisma, repository } = createRepository();

    await expect(repository.claim("hash", NOW)).resolves.toEqual({
      id: "revert-1",
    });

    expect(prisma.emailChangeRevert.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: "hash",
        consumedAt: null,
        expiresAt: { gt: NOW },
      },
      data: { consumedAt: NOW },
    });
  });

  it("gives the loser of a race nothing to read", async () => {
    const { prisma, repository } = createRepository();
    prisma.emailChangeRevert.updateMany.mockResolvedValue({ count: 0 });

    await expect(repository.claim("hash", NOW)).resolves.toBeNull();

    expect(prisma.emailChangeRevert.findUnique).not.toHaveBeenCalled();
  });

  it("releases a claimed link", async () => {
    const { prisma, repository } = createRepository();

    await repository.release("revert-1");

    expect(prisma.emailChangeRevert.updateMany).toHaveBeenCalledWith({
      where: { id: "revert-1" },
      data: { consumedAt: null },
    });
  });

  it("finds a hold from an open link, however the address is cased", async () => {
    const { prisma, repository } = createRepository();
    prisma.emailChangeRevert.findFirst.mockResolvedValue({ id: "revert-1" });

    await expect(
      repository.isAddressHeld(" Old@Rentify.local ", undefined, NOW),
    ).resolves.toBe(true);

    expect(prisma.emailChangeRevert.findFirst).toHaveBeenCalledWith({
      where: {
        oldEmail: "old@rentify.local",
        consumedAt: null,
        expiresAt: { gt: NOW },
      },
      select: { id: true },
    });
  });

  it("exempts the account the hold belongs to", async () => {
    const { prisma, repository } = createRepository();

    await expect(
      repository.isAddressHeld("old@rentify.local", OTHER_USER_ID, NOW),
    ).resolves.toBe(false);

    expect(prisma.emailChangeRevert.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: { not: OTHER_USER_ID } }),
      select: { id: true },
    });
  });

  it("deletes what has expired", async () => {
    const { prisma, repository } = createRepository();

    await expect(repository.deleteExpired(NOW)).resolves.toBe(3);

    expect(prisma.emailChangeRevert.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: NOW } },
    });
  });
});
