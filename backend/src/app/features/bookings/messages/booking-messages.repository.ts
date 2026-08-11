import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type { BookingParticipantSide } from "@/features/bookings/booking-participants";
import type {
  BookingMessageRecord,
  BookingMessagesPagination,
} from "@/features/bookings/messages/booking-messages.model";

type BookingMessagePersistence = Prisma.BookingMessageGetPayload<object>;

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
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt ? row.readAt.toISOString() : null,
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
