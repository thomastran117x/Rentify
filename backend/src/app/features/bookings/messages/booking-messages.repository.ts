import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type { BookingParticipantSide } from "@/features/bookings/booking-participants";
import type {
  BookingMessageRecord,
  BookingMessagesPagination,
} from "@/features/bookings/messages/booking-messages.model";

const AUTHOR_INCLUDE = {
  author: {
    select: {
      profile: {
        select: { username: true },
      },
    },
  },
} as const;

type BookingMessagePersistence = Prisma.BookingMessageGetPayload<{
  include: typeof AUTHOR_INCLUDE;
}>;

export type BookingMessageEmailContext = Prisma.BookingMessageGetPayload<{
  include: {
    bookingRequest: {
      select: {
        id: true;
        renterId: true;
        organizationId: true;
        posting: {
          select: {
            name: true;
          };
        };
      };
    };
    author: {
      select: {
        firstName: true;
        lastName: true;
      };
    };
  };
}>;

export interface CreateBookingMessageInput {
  bookingRequestId: string;
  authorId: string;
  body: string;
  /** The booking's renter, used to derive `authorSide` on the returned record. */
  renterId: string;
}

export interface ListBookingMessagesPersistenceInput {
  bookingRequestId: string;
  renterId: string;
  page: number;
  pageSize: number;
}

export interface BookingMessageSideScopeInput {
  bookingRequestId: string;
  renterId: string;
  side: BookingParticipantSide;
}

export interface MarkBookingMessagesReadPersistenceInput
  extends BookingMessageSideScopeInput {
  readAt: Date;
}

export class BookingMessagesRepository extends BaseRepository {
  async create(
    input: CreateBookingMessageInput,
  ): Promise<BookingMessageRecord> {
    const created = await this.executeAsync(() =>
      this.prisma.bookingMessage.create({
        data: {
          id: randomUUID(),
          bookingRequestId: input.bookingRequestId,
          authorId: input.authorId,
          body: input.body,
        },
        include: AUTHOR_INCLUDE,
      }),
    );

    return this.mapMessage(created, input.renterId);
  }

  async listByBookingRequest(
    input: ListBookingMessagesPersistenceInput,
  ): Promise<{
    messages: BookingMessageRecord[];
    pagination: BookingMessagesPagination;
  }> {
    const where: Prisma.BookingMessageWhereInput = {
      bookingRequestId: input.bookingRequestId,
    };
    const skip = (input.page - 1) * input.pageSize;

    const [rows, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.bookingMessage.findMany({
          where,
          skip,
          take: input.pageSize,
          // `id` breaks ties: two messages can share a DATETIME(6) value, and an
          // unstable sort would duplicate or drop rows across pages.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: AUTHOR_INCLUDE,
        }),
        this.prisma.bookingMessage.count({ where }),
      ]),
    );

    return {
      messages: rows.map((row) => this.mapMessage(row, input.renterId)),
      pagination: this.createPagination(input.page, input.pageSize, total),
    };
  }

  async countUnreadForSide(
    input: BookingMessageSideScopeInput,
  ): Promise<number> {
    return this.executeAsync(() =>
      this.prisma.bookingMessage.count({
        where: this.buildUnreadForSideWhere(input),
      }),
    );
  }

  async markReadForSide(
    input: MarkBookingMessagesReadPersistenceInput,
  ): Promise<number> {
    const result = await this.executeAsync(() =>
      this.prisma.bookingMessage.updateMany({
        where: {
          ...this.buildUnreadForSideWhere(input),
          // Another process can insert a message between the caller capturing
          // `readAt` and this update running. Without the cutoff that row is
          // marked read with a timestamp older than its own creation, which
          // contradicts the event clients already filter on.
          createdAt: { lte: input.readAt },
        },
        data: { readAt: input.readAt },
      }),
    );

    return result.count;
  }

  async findById(
    messageId: string,
    renterId: string,
  ): Promise<BookingMessageRecord | null> {
    const row = await this.executeAsync(() =>
      this.prisma.bookingMessage.findUnique({
        where: { id: messageId },
        include: AUTHOR_INCLUDE,
      }),
    );

    return row ? this.mapMessage(row, renterId) : null;
  }

  /**
   * Eligibility is re-asserted inside the write so concurrent requests cannot
   * both pass an earlier check: without it a PATCH landing after a DELETE would
   * restore a body while leaving `deletedAt` set, and two DELETEs would both
   * report success.
   */
  private buildEligibleWhere(input: {
    messageId: string;
    authorId: string;
    notBefore: Date;
  }): Prisma.BookingMessageWhereInput {
    return {
      id: input.messageId,
      authorId: input.authorId,
      deletedAt: null,
      createdAt: { gte: input.notBefore },
    };
  }

  async updateBodyIfEligible(input: {
    messageId: string;
    authorId: string;
    body: string;
    editedAt: Date;
    notBefore: Date;
    renterId: string;
  }): Promise<BookingMessageRecord | null> {
    const result = await this.executeAsync(() =>
      this.prisma.bookingMessage.updateMany({
        where: this.buildEligibleWhere(input),
        data: { body: input.body, editedAt: input.editedAt },
      }),
    );

    if (result.count === 0) {
      return null;
    }

    return this.findById(input.messageId, input.renterId);
  }

  async softDeleteIfEligible(input: {
    messageId: string;
    authorId: string;
    deletedAt: Date;
    notBefore: Date;
    renterId: string;
  }): Promise<BookingMessageRecord | null> {
    const result = await this.executeAsync(() =>
      this.prisma.bookingMessage.updateMany({
        where: this.buildEligibleWhere(input),
        // The row survives so the booking keeps a record that a message
        // existed; only its text is removed.
        data: { body: "", deletedAt: input.deletedAt },
      }),
    );

    if (result.count === 0) {
      return null;
    }

    return this.findById(input.messageId, input.renterId);
  }

  /**
   * The two named parties on a thread: the renting user and the owning
   * organization. One query so the list endpoint can tell each side who they
   * are talking to.
   */
  async findThreadParties(bookingRequestId: string): Promise<{
    organizationName: string;
    renterUsername: string;
  } | null> {
    const booking = await this.executeAsync(() =>
      this.prisma.bookingRequest.findUnique({
        where: { id: bookingRequestId },
        select: {
          organization: { select: { name: true } },
          renter: { select: { profile: { select: { username: true } } } },
        },
      }),
    );

    if (!booking) {
      return null;
    }

    return {
      organizationName: booking.organization?.name ?? "the organization",
      renterUsername: booking.renter?.profile?.username ?? "the renter",
    };
  }

  async findByIdWithContext(
    messageId: string,
  ): Promise<BookingMessageEmailContext | null> {
    return this.executeAsync(() =>
      this.prisma.bookingMessage.findUnique({
        where: { id: messageId },
        include: {
          bookingRequest: {
            select: {
              id: true,
              renterId: true,
              organizationId: true,
              posting: {
                select: {
                  name: true,
                },
              },
            },
          },
          author: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
    );
  }

  /**
   * Unread messages addressed to `side` — that is, messages the *other* side
   * authored. The renter side is a single user id, so both branches are
   * expressed against `renterId`.
   */
  private buildUnreadForSideWhere(
    input: BookingMessageSideScopeInput,
  ): Prisma.BookingMessageWhereInput {
    return {
      bookingRequestId: input.bookingRequestId,
      readAt: null,
      authorId:
        input.side === "renter"
          ? { not: input.renterId }
          : { equals: input.renterId },
    };
  }

  private mapMessage(
    row: BookingMessagePersistence,
    renterId: string,
  ): BookingMessageRecord {
    return {
      id: row.id,
      bookingRequestId: row.bookingRequestId,
      authorId: row.authorId,
      authorSide: row.authorId === renterId ? "renter" : "owner",
      authorUsername: row.author?.profile?.username ?? "Unknown",
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt ? row.readAt.toISOString() : null,
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }

  private createPagination(
    page: number,
    pageSize: number,
    total: number,
  ): BookingMessagesPagination {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }
}
