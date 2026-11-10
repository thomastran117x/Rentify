import { Prisma, type UserWebAuthnCredential } from "@/generated/prisma/client";
import {
  MAX_PASSKEYS_PER_USER,
  type NewPasskeyRow,
} from "@/features/auth/mfa/passkey/passkey.model";

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

/**
 * PasskeyRepository over an array, with the same scoping and conditional
 * writes, so service tests can run whole ceremonies against it.
 */
export function createInMemoryPasskeyRepository(
  initial: UserWebAuthnCredential[] = [],
) {
  const rows = [...initial];
  const forUser = (userId: string) =>
    rows.filter((row) => row.userId === userId);

  return {
    rows,
    listByUserId: jest.fn(async (userId: string) => forUser(userId)),
    countByUserId: jest.fn(async (userId: string) => forUser(userId).length),
    findForUser: jest.fn(
      async (userId: string, id: string) =>
        rows.find((row) => row.userId === userId && row.id === id) ?? null,
    ),
    findByCredentialIdForUser: jest.fn(
      async (userId: string, credentialId: Uint8Array) =>
        rows.find(
          (row) =>
            row.userId === userId && sameBytes(row.credentialId, credentialId),
        ) ?? null,
    ),
    createWithinCap: jest.fn(async (row: NewPasskeyRow) => {
      if (
        rows.some((existing) =>
          sameBytes(existing.credentialId, row.credentialId),
        )
      ) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
          code: "P2002",
          clientVersion: "test",
        });
      }

      if (forUser(row.userId).length >= MAX_PASSKEYS_PER_USER) {
        return { status: "limit_reached" as const };
      }

      const created = buildPasskeyRow(row);
      rows.push(created);
      return { status: "created" as const, row: created };
    }),
    rename: jest.fn(async (userId: string, id: string, name: string) => {
      const row = rows.find(
        (entry) => entry.userId === userId && entry.id === id,
      );
      if (!row) {
        return null;
      }
      row.name = name;
      return row;
    }),
    deleteForUser: jest.fn(async (userId: string, id: string) => {
      const index = rows.findIndex(
        (entry) => entry.userId === userId && entry.id === id,
      );
      if (index === -1) {
        return null;
      }
      const [removed] = rows.splice(index, 1);
      return removed;
    }),
    claimSignCount: jest.fn(
      async (input: {
        id: string;
        expectedSignCount: bigint;
        signCount: number;
        backedUp: boolean;
        usedAt: Date;
      }) => {
        const row = rows.find((entry) => entry.id === input.id);
        if (!row || row.signCount !== input.expectedSignCount) {
          return false;
        }
        row.signCount = BigInt(input.signCount);
        row.backedUp = input.backedUp;
        row.lastUsedAt = input.usedAt;
        return true;
      },
    ),
  };
}

export function buildPasskeyRow(
  row: Partial<NewPasskeyRow> & Pick<NewPasskeyRow, "id" | "userId">,
): UserWebAuthnCredential {
  return {
    id: row.id,
    userId: row.userId,
    credentialId: row.credentialId ?? Uint8Array.from(Buffer.from(row.id)),
    publicKey: row.publicKey ?? Uint8Array.from([1, 2, 3]),
    signCount: BigInt(row.signCount ?? 0),
    transports: row.transports ?? ["internal"],
    aaguid: row.aaguid ?? "00000000-0000-0000-0000-000000000000",
    backedUp: row.backedUp ?? false,
    deviceType: row.deviceType ?? "single_device",
    name: row.name ?? "Passkey",
    createdAt: new Date("2026-11-10T09:00:00.000Z"),
    lastUsedAt: null,
  };
}
