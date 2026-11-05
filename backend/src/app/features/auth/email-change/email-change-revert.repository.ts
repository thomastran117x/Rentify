import type { Uuid } from "@/configuration/validation/uuid";
import { newUuid } from "@/configuration/validation/uuid";
import type { EmailChangeRevertRecord } from "@/features/auth/email-change/email-change.model";
import { BaseRepository } from "@/features/base/base.repository";

export interface CreateEmailChangeRevertInput {
  userId: Uuid;
  tokenHash: string;
  oldEmail: string;
  newEmail: string;
  sourceEventId: Uuid;
  expiresAt: Date;
}

/**
 * The links that undo an email change, and through them the addresses held for
 * those links. In MySQL rather than beside the shorter-lived auth tokens in
 * Redis because a link may be the owner's only way back for a week, so it has
 * to outlast a cache flush.
 */
export class EmailChangeRevertRepository extends BaseRepository {
  /**
   * Stores a new link and retires the account's earlier ones in one step. An
   * account has one open link at most: the earlier ones name an address it has
   * since left, so they must not work, and their holds must not outlive them.
   */
  async replaceOpenForUser(
    input: CreateEmailChangeRevertInput,
    now: Date,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.$transaction([
        this.prisma.emailChangeRevert.updateMany({
          where: { userId: input.userId, consumedAt: null },
          data: { consumedAt: now },
        }),
        this.prisma.emailChangeRevert.create({
          data: {
            id: newUuid(),
            userId: input.userId,
            tokenHash: input.tokenHash,
            oldEmail: normalizeEmail(input.oldEmail),
            newEmail: normalizeEmail(input.newEmail),
            sourceEventId: input.sourceEventId,
            expiresAt: input.expiresAt,
          },
        }),
      ]),
    );
  }

  /**
   * Takes a link, once. Only the request whose write matched the unused row
   * goes on to read it, so a link used twice, or by two racing requests, is
   * acted on at most once.
   */
  async claim(
    tokenHash: string,
    now: Date,
  ): Promise<EmailChangeRevertRecord | null> {
    const { count } = await this.executeAsync(() =>
      this.prisma.emailChangeRevert.updateMany({
        where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      }),
    );

    if (count === 0) {
      return null;
    }

    return this.executeAsync(() =>
      this.prisma.emailChangeRevert.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          oldEmail: true,
          newEmail: true,
          sourceEventId: true,
        },
      }),
    );
  }

  /** Makes a claimed link usable again, keeping its original expiry. */
  async release(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.emailChangeRevert.updateMany({
        where: { id },
        data: { consumedAt: null },
      }),
    );
  }

  /**
   * Whether an open link needs this address to stay free. `allowedUserId`
   * exempts the account the link belongs to, which is allowed to move back.
   */
  async isAddressHeld(
    email: string,
    allowedUserId?: Uuid,
    now: Date = new Date(),
  ): Promise<boolean> {
    const hold = await this.executeAsync(() =>
      this.prisma.emailChangeRevert.findFirst({
        where: {
          oldEmail: normalizeEmail(email),
          consumedAt: null,
          expiresAt: { gt: now },
          ...(allowedUserId ? { userId: { not: allowedUserId } } : {}),
        },
        select: { id: true },
      }),
    );

    return hold !== null;
  }

  /** Rows past their expiry do nothing but keep plain addresses around. */
  async deleteExpired(now: Date): Promise<number> {
    const { count } = await this.executeAsync(() =>
      this.prisma.emailChangeRevert.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
    );

    return count;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
