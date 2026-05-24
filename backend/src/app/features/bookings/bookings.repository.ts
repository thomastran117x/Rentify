import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import {
  DEFAULT_MAX_BOOKING_DURATION_DAYS,
  type PostingPricing,
} from "@/features/postings/postings.model";
import type {
  ActiveBookingOverlapInput,
  BookingDashboardPostingOption,
  BookingCancellationActor,
  BookingRequestExpirationRecord,
  BookingRequestRecord,
  BookingRequestsListResult,
  BookingRequestStatus,
  CreateBookingRequestPersistenceInput,
  ListOwnedBookingRequestsInput,
  ListOwnerBookingRequestsInput,
  ListRenterBookingRequestsInput,
  OwnerBookingDashboardInput,
  RenterBookingDashboardInput,
} from "@/features/bookings/bookings.model";

type BookingRequestPersistence = Prisma.BookingRequestGetPayload<{
  include: {
    renting: {
      select: {
        id: true;
      };
    };
    posting: {
      include: {
        photos: {
          orderBy: {
            position: "asc";
          };
        };
      };
    };
  };
}>;

export class BookingsRepository extends BaseRepository {
  private readonly activeBookingStatuses: BookingRequestStatus[] = [
    "pending",
    "approved",
    "awaiting_payment",
    "payment_processing",
    "payment_failed",
    "paid",
  ];

  async create(input: CreateBookingRequestPersistenceInput): Promise<BookingRequestRecord> {
    const created = await this.executeAsync(() =>
      this.prisma.bookingRequest.create({
        data: {
          id: randomUUID(),
          postingId: input.postingId,
          renterId: input.renterId,
          ownerId: input.ownerId,
          status: "pending",
          startAt: input.startAt,
          endAt: input.endAt,
          durationDays: input.durationDays,
          guestCount: input.guestCount,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          contactPhoneNumber: input.contactPhoneNumber ?? null,
          note: input.note ?? null,
          pricingCurrency: input.pricingCurrency,
          pricingSnapshot: input.pricingSnapshot as Prisma.InputJsonValue,
          dailyPriceAmount: new Prisma.Decimal(input.dailyPriceAmount),
          estimatedTotal: new Prisma.Decimal(input.estimatedTotal),
          holdExpiresAt: input.holdExpiresAt,
        },
        include: {
          renting: {
            select: {
              id: true,
            },
          },
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
        },
      }),
    );

    return this.mapBookingRequest(created);
  }

  async createIfWithinActiveRequestLimit(
    input: CreateBookingRequestPersistenceInput,
    maxActiveRequests: number,
  ): Promise<BookingRequestRecord | null> {
    const created = await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const activeRequestCount = await transaction.bookingRequest.count({
          where: {
            postingId: input.postingId,
            renterId: input.renterId,
            status: {
              in: this.activeBookingStatuses,
            },
            convertedAt: null,
          },
        });

        if (activeRequestCount >= maxActiveRequests) {
          return null;
        }

        return transaction.bookingRequest.create({
          data: {
            id: randomUUID(),
            postingId: input.postingId,
            renterId: input.renterId,
            ownerId: input.ownerId,
            status: "pending",
            startAt: input.startAt,
            endAt: input.endAt,
            durationDays: input.durationDays,
            guestCount: input.guestCount,
            contactName: input.contactName,
            contactEmail: input.contactEmail,
            contactPhoneNumber: input.contactPhoneNumber ?? null,
            note: input.note ?? null,
            pricingCurrency: input.pricingCurrency,
            pricingSnapshot: input.pricingSnapshot as Prisma.InputJsonValue,
            dailyPriceAmount: new Prisma.Decimal(input.dailyPriceAmount),
            estimatedTotal: new Prisma.Decimal(input.estimatedTotal),
            holdExpiresAt: input.holdExpiresAt,
          },
          include: {
            renting: {
              select: {
                id: true,
              },
            },
            posting: {
              include: {
                photos: {
                  orderBy: {
                    position: "asc",
                  },
                },
              },
            },
          },
        });
      }),
    );

    return created ? this.mapBookingRequest(created) : null;
  }

  async findById(id: string): Promise<BookingRequestRecord | null> {
    const bookingRequest = await this.executeAsync(() =>
      this.prisma.bookingRequest.findUnique({
        where: {
          id,
        },
        include: {
          renting: {
            select: {
              id: true,
            },
          },
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
        },
      }),
    );

    return bookingRequest ? this.mapBookingRequest(bookingRequest) : null;
  }

  async updatePending(
    bookingRequestId: string,
    renterId: string,
    input: {
      startAt: Date;
      endAt: Date;
      durationDays: number;
      guestCount: number;
      contactName: string;
      contactEmail: string;
      contactPhoneNumber?: string | null;
      note?: string | null;
      pricingCurrency: string;
      pricingSnapshot: PostingPricing;
      dailyPriceAmount: number;
      estimatedTotal: number;
    },
  ): Promise<BookingRequestRecord | null> {
    const updated = await this.executeAsync(async () =>
      this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.bookingRequest.findUnique({
          where: {
            id: bookingRequestId,
          },
          select: {
            id: true,
            renterId: true,
            status: true,
            holdExpiresAt: true,
          },
        });

        if (!existing || existing.renterId !== renterId) {
          return null;
        }

        if (existing.status !== "pending" || existing.holdExpiresAt.getTime() <= Date.now()) {
          return null;
        }

        const result = await transaction.bookingRequest.updateMany({
          where: {
            id: bookingRequestId,
            renterId,
            status: "pending",
            holdExpiresAt: {
              gt: new Date(),
            },
          },
          data: {
            startAt: input.startAt,
            endAt: input.endAt,
            durationDays: input.durationDays,
            guestCount: input.guestCount,
            contactName: input.contactName,
            contactEmail: input.contactEmail,
            contactPhoneNumber: input.contactPhoneNumber ?? null,
            note: input.note ?? null,
            pricingCurrency: input.pricingCurrency,
            pricingSnapshot: input.pricingSnapshot as Prisma.InputJsonValue,
            dailyPriceAmount: new Prisma.Decimal(input.dailyPriceAmount),
            estimatedTotal: new Prisma.Decimal(input.estimatedTotal),
          },
        });

        if (result.count !== 1) {
          return null;
        }

        return transaction.bookingRequest.findUniqueOrThrow({
          where: {
            id: bookingRequestId,
          },
          include: {
            renting: {
              select: {
                id: true,
              },
            },
            posting: {
              include: {
                photos: {
                  orderBy: {
                    position: "asc",
                  },
                },
              },
            },
          },
        });
      }),
    );

    return updated ? this.mapBookingRequest(updated) : null;
  }

  async listByRenter(input: ListRenterBookingRequestsInput): Promise<BookingRequestsListResult> {
    const where: Prisma.BookingRequestWhereInput = {
      renterId: input.renterId,
      ...(input.status ? { status: input.status } : {}),
    };
    const skip = (input.page - 1) * input.pageSize;

    const [rows, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.bookingRequest.findMany({
          where,
          skip,
          take: input.pageSize,
          orderBy: [{ createdAt: "desc" }],
          include: {
            renting: {
              select: {
                id: true,
              },
            },
            posting: {
              include: {
                photos: {
                  orderBy: {
                    position: "asc",
                  },
                },
              },
            },
          },
        }),
        this.prisma.bookingRequest.count({ where }),
      ]),
    );

    return {
      bookingRequests: rows.map((row) => this.mapBookingRequest(row)),
      pagination: this.createPagination(input.page, input.pageSize, total),
      ...(input.status ? { status: input.status } : {}),
    };
  }

  async listByOwnerAndPosting(
    input: ListOwnerBookingRequestsInput,
  ): Promise<BookingRequestsListResult> {
    const where: Prisma.BookingRequestWhereInput = {
      ownerId: input.ownerId,
      postingId: input.postingId,
      ...(input.status ? { status: input.status } : {}),
    };
    const skip = (input.page - 1) * input.pageSize;

    const [rows, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.bookingRequest.findMany({
          where,
          skip,
          take: input.pageSize,
          orderBy: [{ createdAt: "desc" }],
          include: {
            renting: {
              select: {
                id: true,
              },
            },
            posting: {
              include: {
                photos: {
                  orderBy: {
                    position: "asc",
                  },
                },
              },
            },
          },
        }),
        this.prisma.bookingRequest.count({ where }),
      ]),
    );

    return {
      bookingRequests: rows.map((row) => this.mapBookingRequest(row)),
      pagination: this.createPagination(input.page, input.pageSize, total),
      ...(input.status ? { status: input.status } : {}),
    };
  }

  async listByOwner(input: ListOwnedBookingRequestsInput): Promise<BookingRequestsListResult> {
    const where: Prisma.BookingRequestWhereInput = {
      ownerId: input.ownerId,
      ...(input.status ? { status: input.status } : {}),
    };
    const skip = (input.page - 1) * input.pageSize;

    const [rows, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.bookingRequest.findMany({
          where,
          skip,
          take: input.pageSize,
          orderBy: [{ createdAt: "desc" }],
          include: {
            renting: {
              select: {
                id: true,
              },
            },
            posting: {
              include: {
                photos: {
                  orderBy: {
                    position: "asc",
                  },
                },
              },
            },
          },
        }),
        this.prisma.bookingRequest.count({ where }),
      ]),
    );

    return {
      bookingRequests: rows.map((row) => this.mapBookingRequest(row)),
      pagination: this.createPagination(input.page, input.pageSize, total),
      ...(input.status ? { status: input.status } : {}),
    };
  }

  async listDashboardByRenter(
    input: Pick<RenterBookingDashboardInput, "renterId" | "status">,
  ): Promise<BookingRequestRecord[]> {
    const where: Prisma.BookingRequestWhereInput = {
      renterId: input.renterId,
      ...(input.status ? { status: input.status } : {}),
    };

    const rows = await this.executeAsync(() =>
      this.prisma.bookingRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        include: {
          renting: {
            select: {
              id: true,
            },
          },
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
        },
      }),
    );

    return rows.map((row) => this.mapBookingRequest(row));
  }

  async listDashboardByOwner(
    input: Pick<OwnerBookingDashboardInput, "ownerId" | "status" | "postingId">,
  ): Promise<BookingRequestRecord[]> {
    const where: Prisma.BookingRequestWhereInput = {
      ownerId: input.ownerId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.postingId ? { postingId: input.postingId } : {}),
    };

    const rows = await this.executeAsync(() =>
      this.prisma.bookingRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        include: {
          renting: {
            select: {
              id: true,
            },
          },
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
        },
      }),
    );

    return rows.map((row) => this.mapBookingRequest(row));
  }

  async listDashboardPostingOptionsByOwner(ownerId: string): Promise<BookingDashboardPostingOption[]> {
    const rows = await this.executeAsync(() =>
      this.prisma.bookingRequest.findMany({
        where: {
          ownerId,
        },
        select: {
          postingId: true,
          posting: {
            select: {
              name: true,
            },
          },
        },
        orderBy: [{ posting: { name: "asc" } }, { createdAt: "desc" }],
      }),
    );

    const options = new Map<string, BookingDashboardPostingOption>();

    for (const row of rows) {
      if (!options.has(row.postingId)) {
        options.set(row.postingId, {
          id: row.postingId,
          name: row.posting.name,
        });
      }
    }

    return Array.from(options.values());
  }

  async hasOfficialReservationOverlap(input: ActiveBookingOverlapInput): Promise<boolean> {
    const match = await this.executeAsync(() =>
      this.prisma.bookingRequest.findFirst({
        where: {
          postingId: input.postingId,
          status: "paid",
          convertedAt: null,
          ...(input.excludeBookingRequestId
            ? {
                id: {
                  not: input.excludeBookingRequestId,
                },
              }
            : {}),
          ...(input.renterId
            ? {
                renterId: input.renterId,
              }
            : {}),
          startAt: {
            lt: input.endAt,
          },
          endAt: {
            gt: input.startAt,
          },
        },
        select: {
          id: true,
        },
      }),
    );

    return Boolean(match);
  }

  async countActiveRequestsForRenterPosting(input: {
    postingId: string;
    renterId: string;
    excludeBookingRequestId?: string;
  }): Promise<number> {
    return this.executeAsync(() =>
      this.prisma.bookingRequest.count({
        where: {
          postingId: input.postingId,
          renterId: input.renterId,
          status: {
            in: this.activeBookingStatuses,
          },
          convertedAt: null,
          ...(input.excludeBookingRequestId
            ? {
                id: {
                  not: input.excludeBookingRequestId,
                },
              }
            : {}),
        },
      }),
    );
  }

  async approve(
    bookingRequestId: string,
    ownerId: string,
    note: string | null | undefined,
    holdExpiresAt: Date,
  ): Promise<BookingRequestRecord | null> {
    return this.executeAsync(async () => {
      try {
        const approved = await this.prisma.$transaction(async (transaction) => {
          const existing = await transaction.bookingRequest.findUnique({
            where: {
              id: bookingRequestId,
            },
            include: {
              renting: {
                select: {
                  id: true,
                },
              },
              posting: {
                include: {
                  photos: {
                    orderBy: {
                      position: "asc",
                    },
                  },
                },
              },
            },
          });

          if (!existing || existing.ownerId !== ownerId) {
            return null;
          }

          if (existing.status !== "pending" || existing.holdExpiresAt <= new Date()) {
            return null;
          }

          const availabilityBlock = await transaction.postingAvailabilityBlock.findFirst({
            where: {
              postingId: existing.postingId,
              startAt: {
                lt: existing.endAt,
              },
              endAt: {
                gt: existing.startAt,
              },
              OR: [
                {
                  bookingRequestHold: null,
                },
                {
                  bookingRequestHold: {
                    status: "paid",
                    convertedAt: null,
                    id: {
                      not: existing.id,
                    },
                  },
                },
              ],
            },
            select: {
              id: true,
            },
          });

          if (availabilityBlock) {
            throw new BadRequestError("The requested dates are no longer available.");
          }

          const result = await transaction.bookingRequest.updateMany({
            where: {
              id: existing.id,
              ownerId,
              status: "pending",
              holdExpiresAt: {
                gt: new Date(),
              },
            },
            data: {
              status: "awaiting_payment",
              paymentRequiredAt: new Date(),
              paymentFailedAt: null,
              approvedAt: new Date(),
              decisionNote: note ?? null,
              holdExpiresAt,
              holdBlockId: null,
            },
          });

          if (result.count !== 1) {
            return null;
          }

          return transaction.bookingRequest.findUniqueOrThrow({
            where: {
              id: existing.id,
            },
            include: {
              renting: {
                select: {
                  id: true,
                },
              },
              posting: {
                include: {
                  photos: {
                    orderBy: {
                      position: "asc",
                    },
                  },
                },
              },
            },
          });
        });

        return approved ? this.mapBookingRequest(approved) : null;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          return null;
        }

        throw error;
      }
    });
  }

  async decline(
    bookingRequestId: string,
    ownerId: string,
    note: string | null | undefined,
  ): Promise<BookingRequestRecord | null> {
    const declined = await this.executeAsync(async () =>
      this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.bookingRequest.findUnique({
          where: {
            id: bookingRequestId,
          },
          select: {
            id: true,
            ownerId: true,
            status: true,
          },
        });

        if (!existing || existing.ownerId !== ownerId) {
          return null;
        }

        if (existing.status !== "pending") {
          return null;
        }

        const result = await transaction.bookingRequest.updateMany({
          where: {
            id: bookingRequestId,
            ownerId,
            status: "pending",
            holdExpiresAt: {
              gt: new Date(),
            },
          },
          data: {
            status: "declined",
            declinedAt: new Date(),
            decisionNote: note ?? null,
          },
        });

        if (result.count !== 1) {
          return null;
        }

        return transaction.bookingRequest.findUniqueOrThrow({
          where: {
            id: bookingRequestId,
          },
          include: {
            renting: {
              select: {
                id: true,
              },
            },
            posting: {
              include: {
                photos: {
                  orderBy: {
                    position: "asc",
                  },
                },
              },
            },
          },
        });
      }),
    );

    return declined ? this.mapBookingRequest(declined) : null;
  }

  async cancel(input: {
    bookingRequestId: string;
    actorUserId: string;
    actor: BookingCancellationActor;
    expectedStatus: BookingRequestStatus;
    reason?: string | null;
    cancellationPolicyCode: string;
    cancellationRefundAmount: number;
  }): Promise<BookingRequestRecord | null> {
    const cancelled = await this.executeAsync(async () =>
      this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.bookingRequest.findUnique({
          where: {
            id: input.bookingRequestId,
          },
          select: {
            id: true,
            renterId: true,
            ownerId: true,
            status: true,
            holdBlockId: true,
            convertedAt: true,
          },
        });

        if (!existing) {
          return null;
        }

        if (
          (input.actor === "renter" && existing.renterId !== input.actorUserId) ||
          (input.actor === "owner" && existing.ownerId !== input.actorUserId)
        ) {
          return null;
        }

        if (existing.status !== input.expectedStatus || existing.convertedAt) {
          return null;
        }

        const result = await transaction.bookingRequest.updateMany({
          where: {
            id: existing.id,
            status: input.expectedStatus,
            convertedAt: null,
            ...(input.actor === "renter"
              ? {
                  renterId: input.actorUserId,
                }
              : {
                  ownerId: input.actorUserId,
                }),
          },
          data: {
            status: "cancelled",
            cancelledAt: new Date(),
            cancelledByUserId: input.actorUserId,
            cancellationActor: input.actor,
            cancellationReason: input.reason ?? null,
            cancellationPolicyCode: input.cancellationPolicyCode,
            cancellationRefundAmount: new Prisma.Decimal(input.cancellationRefundAmount),
            holdBlockId: null,
            conversionReservedAt: null,
            conversionReservationExpiresAt: null,
          },
        });

        if (result.count !== 1) {
          return null;
        }

        if (existing.holdBlockId) {
          await transaction.postingAvailabilityBlock.deleteMany({
            where: {
              id: existing.holdBlockId,
            },
          });
        }

        return transaction.bookingRequest.findUniqueOrThrow({
          where: {
            id: existing.id,
          },
          include: {
            renting: {
              select: {
                id: true,
              },
            },
            posting: {
              include: {
                photos: {
                  orderBy: {
                    position: "asc",
                  },
                },
              },
            },
          },
        });
      }),
    );

    return cancelled ? this.mapBookingRequest(cancelled) : null;
  }

  async listExpiredCandidates(limit: number): Promise<BookingRequestExpirationRecord[]> {
    const now = new Date();
    const rows = await this.executeAsync(() =>
      this.prisma.bookingRequest.findMany({
        where: {
          status: {
            in: ["pending", "awaiting_payment", "payment_processing", "payment_failed"],
          },
          convertedAt: null,
          OR: [
            {
              conversionReservationExpiresAt: null,
            },
            {
              conversionReservationExpiresAt: {
                lte: now,
              },
            },
          ],
          holdExpiresAt: {
            lte: now,
          },
        },
        orderBy: [{ holdExpiresAt: "asc" }, { createdAt: "asc" }],
        take: limit,
        select: {
          id: true,
          postingId: true,
          ownerId: true,
          status: true,
          holdBlockId: true,
        },
      }),
    );

    return rows.map((row) => ({
      id: row.id,
      postingId: row.postingId,
      ownerId: row.ownerId,
      status: row.status as BookingRequestStatus,
      holdBlockId: row.holdBlockId ?? undefined,
    }));
  }

  async hasBlockingAvailabilityOverlap(input: {
    postingId: string;
    startAt: Date;
    endAt: Date;
    excludeBookingRequestId?: string;
  }): Promise<boolean> {
    const block = await this.executeAsync(() =>
      this.prisma.postingAvailabilityBlock.findFirst({
        where: {
          postingId: input.postingId,
          startAt: {
            lt: input.endAt,
          },
          endAt: {
            gt: input.startAt,
          },
          OR: [
            {
              bookingRequestHold: null,
            },
            {
              bookingRequestHold: {
                status: "paid",
                convertedAt: null,
                ...(input.excludeBookingRequestId
                  ? {
                      id: {
                        not: input.excludeBookingRequestId,
                      },
                    }
                  : {}),
              },
            },
          ],
        },
        select: {
          id: true,
        },
      }),
    );

    return Boolean(block);
  }

  async expire(bookingRequestId: string): Promise<boolean> {
    return this.executeAsync(async () =>
      this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.bookingRequest.findUnique({
          where: {
            id: bookingRequestId,
          },
          select: {
            id: true,
            status: true,
            holdExpiresAt: true,
            holdBlockId: true,
            convertedAt: true,
            conversionReservationExpiresAt: true,
          },
        });

        if (!existing) {
          return false;
        }

        if (!["pending", "awaiting_payment", "payment_processing", "payment_failed"].includes(existing.status)) {
          return false;
        }

        if (existing.convertedAt) {
          return false;
        }

        if (
          existing.conversionReservationExpiresAt &&
          existing.conversionReservationExpiresAt.getTime() > Date.now()
        ) {
          return false;
        }

        if (existing.holdExpiresAt.getTime() > Date.now()) {
          return false;
        }

        const result = await transaction.bookingRequest.updateMany({
          where: {
            id: existing.id,
            status: existing.status,
            holdExpiresAt: {
              lte: new Date(),
            },
            OR: [
              {
                conversionReservationExpiresAt: null,
              },
              {
                conversionReservationExpiresAt: {
                  lte: new Date(),
                },
              },
            ],
          },
          data: {
            status: "expired",
            expiredAt: new Date(),
            holdBlockId: null,
            conversionReservedAt: null,
            conversionReservationExpiresAt: null,
          },
        });

        if (result.count !== 1) {
          return false;
        }

        if (
          ["awaiting_payment", "payment_processing", "payment_failed", "approved"].includes(
            existing.status,
          ) &&
          existing.holdBlockId
        ) {
          await transaction.postingAvailabilityBlock.deleteMany({
            where: {
              id: existing.holdBlockId,
            },
          });
        }

        return true;
      }),
    );
  }

  async reserveForConversion(
    bookingRequestId: string,
    ownerId: string,
    reservationExpiresAt: Date,
  ): Promise<{
    reservedAt: Date;
    reservationExpiresAt: Date;
  }> {
    const now = new Date();
    const result = await this.executeAsync(() =>
      this.prisma.bookingRequest.updateMany({
        where: {
          id: bookingRequestId,
          ownerId,
          status: "paid",
          convertedAt: null,
          OR: [
            {
              conversionReservationExpiresAt: null,
            },
            {
              conversionReservationExpiresAt: {
                lte: now,
              },
            },
          ],
        },
        data: {
          conversionReservedAt: now,
          conversionReservationExpiresAt: reservationExpiresAt,
        },
      }),
    );

    if (result.count !== 1) {
      throw new ConflictError("This booking request is already reserved for conversion.");
    }

    return {
      reservedAt: now,
      reservationExpiresAt,
    };
  }

  async releaseConversionReservation(
    bookingRequestId: string,
    ownerId: string,
    reservation: {
      reservedAt: Date;
      reservationExpiresAt: Date;
    },
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.bookingRequest.updateMany({
        where: {
          id: bookingRequestId,
          ownerId,
          conversionReservedAt: reservation.reservedAt,
          conversionReservationExpiresAt: reservation.reservationExpiresAt,
        },
        data: {
          conversionReservedAt: null,
          conversionReservationExpiresAt: null,
        },
      }),
    );
  }

  private mapBookingRequest(bookingRequest: BookingRequestPersistence): BookingRequestRecord {
    return {
      id: bookingRequest.id,
      postingId: bookingRequest.postingId,
      renterId: bookingRequest.renterId,
      ownerId: bookingRequest.ownerId,
      status: bookingRequest.status as BookingRequestStatus,
      startAt: bookingRequest.startAt.toISOString(),
      endAt: bookingRequest.endAt.toISOString(),
      durationDays: bookingRequest.durationDays,
      guestCount: bookingRequest.guestCount,
      contactName: bookingRequest.contactName,
      contactEmail: bookingRequest.contactEmail,
      contactPhoneNumber: bookingRequest.contactPhoneNumber ?? undefined,
      note: bookingRequest.note ?? undefined,
      pricingCurrency: bookingRequest.pricingCurrency,
      pricingSnapshot: bookingRequest.pricingSnapshot as PostingPricing,
      dailyPriceAmount: Number(bookingRequest.dailyPriceAmount),
      estimatedTotal: Number(bookingRequest.estimatedTotal),
      decisionNote: bookingRequest.decisionNote ?? undefined,
      approvedAt: bookingRequest.approvedAt?.toISOString(),
      paymentRequiredAt: bookingRequest.paymentRequiredAt?.toISOString(),
      paymentFailedAt: bookingRequest.paymentFailedAt?.toISOString(),
      cancelledAt: bookingRequest.cancelledAt?.toISOString(),
      cancelledByUserId: bookingRequest.cancelledByUserId ?? undefined,
      cancellationActor: bookingRequest.cancellationActor ?? undefined,
      cancellationReason: bookingRequest.cancellationReason ?? undefined,
      cancellationPolicyCode: bookingRequest.cancellationPolicyCode ?? undefined,
      cancellationRefundAmount:
        bookingRequest.cancellationRefundAmount !== null &&
        bookingRequest.cancellationRefundAmount !== undefined
          ? Number(bookingRequest.cancellationRefundAmount)
          : undefined,
      refundedAt: bookingRequest.refundedAt?.toISOString(),
      declinedAt: bookingRequest.declinedAt?.toISOString(),
      expiredAt: bookingRequest.expiredAt?.toISOString(),
      convertedAt: bookingRequest.convertedAt?.toISOString(),
      conversionReservedAt: bookingRequest.conversionReservedAt?.toISOString(),
      conversionReservationExpiresAt:
        bookingRequest.conversionReservationExpiresAt?.toISOString(),
      holdExpiresAt: bookingRequest.holdExpiresAt.toISOString(),
      holdBlockId: bookingRequest.holdBlockId ?? undefined,
      paymentReconciliationRequired: bookingRequest.paymentReconciliationRequired,
      rentingId: bookingRequest.renting?.id ?? undefined,
      createdAt: bookingRequest.createdAt.toISOString(),
      updatedAt: bookingRequest.updatedAt.toISOString(),
      posting: {
        id: bookingRequest.posting.id,
        name: bookingRequest.posting.name,
        primaryPhotoUrl: bookingRequest.posting.photos[0]?.blobUrl,
        effectiveMaxBookingDurationDays:
          bookingRequest.posting.maxBookingDurationDays ?? DEFAULT_MAX_BOOKING_DURATION_DAYS,
      },
    };
  }

  private createPagination(page: number, pageSize: number, total: number) {
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
