import {
  hasStrongFactor,
  MfaFactorRepository,
  recordStrongFactorChange,
} from "@/features/auth/mfa/mfa-factor.repository";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 465501);

function createRepository(user: unknown) {
  const prisma = { user: { findUnique: jest.fn(async () => user) } };
  return { prisma, repository: new MfaFactorRepository(prisma as never) };
}

describe("MfaFactorRepository", () => {
  it("summarises the account's factors in one read", async () => {
    const { prisma, repository } = createRepository({
      mfaTotp: { status: "active" },
      _count: { webAuthnCredentials: 2, mfaRecoveryCodes: 7 },
    });

    await expect(repository.getSummary(USER_ID)).resolves.toEqual({
      totpActive: true,
      passkeyCount: 2,
      unusedRecoveryCodes: 7,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: {
        mfaTotp: { select: { status: true } },
        _count: {
          select: {
            webAuthnCredentials: true,
            mfaRecoveryCodes: { where: { usedAt: null } },
          },
        },
      },
    });
  });

  it("does not count a pending authenticator", async () => {
    const { repository } = createRepository({
      mfaTotp: { status: "pending" },
      _count: { webAuthnCredentials: 0, mfaRecoveryCodes: 0 },
    });

    await expect(repository.getSummary(USER_ID)).resolves.toMatchObject({
      totpActive: false,
    });
  });

  it("reports nothing for an account that is gone", async () => {
    const { repository } = createRepository(null);

    await expect(repository.getSummary(USER_ID)).resolves.toEqual({
      totpActive: false,
      passkeyCount: 0,
      unusedRecoveryCodes: 0,
    });
  });

  it("treats a passkey or an active authenticator as strong", () => {
    expect(hasStrongFactor({ totpActive: false, passkeyCount: 0 })).toBe(false);
    expect(hasStrongFactor({ totpActive: true, passkeyCount: 0 })).toBe(true);
    expect(hasStrongFactor({ totpActive: false, passkeyCount: 1 })).toBe(true);
  });
});

describe("recordStrongFactorChange", () => {
  it("bumps the factor version, counts trust in force and clears every device's trust", async () => {
    const now = new Date("2026-11-15T00:00:00.000Z");
    const transaction = {
      user: {
        update: jest.fn(async () => ({ tokenVersion: 3, mfaFactorVersion: 5 })),
      },
      device: {
        count: jest.fn(async () => 2),
        updateMany: jest.fn(async () => ({ count: 4 })),
      },
    };

    await expect(
      recordStrongFactorChange(transaction as never, USER_ID, now),
    ).resolves.toBe(2);
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { mfaFactorVersion: { increment: 1 } },
      select: { tokenVersion: true, mfaFactorVersion: true },
    });
    // Only trust at the versions before this change was still in force.
    expect(transaction.device.count).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        trustedUntil: { gt: now },
        trustedTokenVersion: 3,
        trustedMfaVersion: 4,
      },
    });
    expect(transaction.device.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, trustedUntil: { not: null } },
      data: {
        trustedUntil: null,
        trustedTokenVersion: null,
        trustedMfaVersion: null,
      },
    });
  });
});
