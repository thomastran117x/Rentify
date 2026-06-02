import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import type {
  CreateRentingDisputeInput,
  ListMyRentingsInput,
  ListOwnerDashboardRentingsInput,
  ListRentingsResult,
  RentingDisputeRecord,
  RentingRecord,
  RentingStatus,
  UpdateRentingInstructionsInput,
} from "@/features/rentings/rentings.model";
import type { PostingPricing } from "@/features/postings/postings.model";

type RentingPersistence = Prisma.RentingGetPayload<{
  include: {
    posting: {
      include: {
        photos: {
          orderBy: {
            position: "asc";
          };
        };
      };
    };
    dispute: true;
  };
}>;

export class RentingsRepository extends BaseRepository {
  async convertApprovedBookingRequest(
    bookingRequestId: string,
    organizationId: string,
  ): Promise<RentingRecord | null> {
    return this.executeAsync(async () => {
      try {
        return await this.prisma.$transaction(async (transaction) => {
          const bookingRequest = await transaction.bookingRequest.findUnique({
            where: {
              id: bookingRequestId,
            },
            include: {
              posting: {
                include: {
                  photos: {
                    orderBy: {
                      position: "asc",
                    },
                  },
                },
              },
              renting: {
                select: {
                  id: true,
                },
              },
            },
          });

          if (
            !bookingRequest ||
            bookingRequest.organizationId !== organizationId
          ) {
            return null;
          }

          const now = new Date();

          if (bookingRequest.status !== "paid") {
            throw new BadRequestError(
              "Only paid booking requests can be converted into rentings.",
            );
          }

          if (bookingRequest.convertedAt || bookingRequest.renting) {
            throw new BadRequestError(
              "This booking request has already been converted into a renting.",
            );
          }

          if (
            !bookingRequest.conversionReservationExpiresAt ||
            bookingRequest.conversionReservationExpiresAt.getTime() <=
              now.getTime()
          ) {
            throw new BadRequestError(
              "This booking request is not currently reserved for conversion.",
            );
          }

          const overlapWithRenting = await transaction.renting.findFirst({
            where: {
              postingId: bookingRequest.postingId,
              startAt: {
                lt: bookingRequest.endAt,
              },
              endAt: {
                gt: bookingRequest.startAt,
              },
            },
            select: {
              id: true,
            },
          });

          if (overlapWithRenting) {
            throw new BadRequestError(
              "The requested dates are no longer available.",
            );
          }

          if (bookingRequest.holdBlockId) {
            await transaction.postingAvailabilityBlock.deleteMany({
              where: {
                id: bookingRequest.holdBlockId,
              },
            });
          }

          await transaction.postingAvailabilityBlock.create({
            data: {
              id: randomUUID(),
              postingId: bookingRequest.postingId,
              startAt: bookingRequest.startAt,
              endAt: bookingRequest.endAt,
              note: `Renting confirmed from booking request: ${bookingRequest.id}`,
              source: "renting",
            },
          });

          const renting = await transaction.renting.create({
            data: {
              id: randomUUID(),
              postingId: bookingRequest.postingId,
              bookingRequestId: bookingRequest.id,
              renterId: bookingRequest.renterId,
              organizationId: bookingRequest.organizationId,
              status: "confirmed",
              startAt: bookingRequest.startAt,
              endAt: bookingRequest.endAt,
              durationDays: bookingRequest.durationDays,
              guestCount: bookingRequest.guestCount,
              pricingCurrency: bookingRequest.pricingCurrency,
              pricingSnapshot:
                bookingRequest.pricingSnapshot as Prisma.InputJsonValue,
              dailyPriceAmount: bookingRequest.dailyPriceAmount,
              estimatedTotal: bookingRequest.estimatedTotal,
              confirmedAt: now,
            },
            include: {
              posting: {
                include: {
                  photos: {
                    orderBy: {
                      position: "asc",
                    },
                  },
                },
              },
              dispute: true,
            },
          });

          await transaction.bookingRequest.update({
            where: {
              id: bookingRequest.id,
            },
            data: {
              convertedAt: now,
              conversionReservedAt: null,
              conversionReservationExpiresAt: null,
              holdBlockId: null,
            },
          });

          return this.mapRenting(renting);
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new ConflictError(
            "This booking request has already been converted into a renting.",
          );
        }

        throw error;
      }
    });
  }

  async promoteReturnDueForRenting(
    rentingId: string,
    now: Date,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.renting.updateMany({
        where: {
          id: rentingId,
          status: "active",
          endAt: {
            lte: now,
          },
        },
        data: {
          status: "return_due",
          returnDueAt: now,
        },
      }),
    );
  }

  async promoteReturnDueForUser(userId: string, now: Date): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.renting.updateMany({
        where: {
          renterId: userId,
          status: "active",
          endAt: {
            lte: now,
          },
        },
        data: {
          status: "return_due",
          returnDueAt: now,
        },
      }),
    );
  }

  async promoteReturnDueForOwner(
    input: ListOwnerDashboardRentingsInput,
    now: Date,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.renting.updateMany({
        where: {
          organizationId: input.organizationId,
          ...(input.postingId ? { postingId: input.postingId } : {}),
          status: "active",
          endAt: {
            lte: now,
          },
        },
        data: {
          status: "return_due",
          returnDueAt: now,
        },
      }),
    );
  }

  async findById(id: string): Promise<RentingRecord | null> {
    const renting = await this.executeAsync(() =>
      this.prisma.renting.findUnique({
        where: {
          id,
        },
        include: {
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
          dispute: true,
        },
      }),
    );

    return renting ? this.mapRenting(renting) : null;
  }

  async listMine(input: ListMyRentingsInput): Promise<ListRentingsResult> {
    const where: Prisma.RentingWhereInput = {
      OR: [
        { renterId: input.userId },
        ...(input.organizationId
          ? [{ organizationId: input.organizationId }]
          : []),
      ],
      ...(input.status ? { status: input.status } : {}),
    };
    const skip = (input.page - 1) * input.pageSize;

    const [rentings, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.renting.findMany({
          where,
          skip,
          take: input.pageSize,
          orderBy: [{ startAt: "asc" }, { createdAt: "desc" }],
          include: {
            posting: {
              include: {
                photos: {
                  orderBy: {
                    position: "asc",
                  },
                },
              },
            },
            dispute: true,
          },
        }),
        this.prisma.renting.count({ where }),
      ]),
    );

    return {
      rentings: rentings.map((renting) => this.mapRenting(renting)),
      pagination: this.createPagination(input.page, input.pageSize, total),
      ...(input.status ? { status: input.status } : {}),
    };
  }

  async listByRenterForDashboard(renterId: string): Promise<RentingRecord[]> {
    const rentings = await this.executeAsync(() =>
      this.prisma.renting.findMany({
        where: {
          renterId,
        },
        orderBy: [{ startAt: "asc" }, { createdAt: "desc" }],
        include: {
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
          dispute: true,
        },
      }),
    );

    return rentings.map((renting) => this.mapRenting(renting));
  }

  async listByOwnerForDashboard(
    input: ListOwnerDashboardRentingsInput,
  ): Promise<RentingRecord[]> {
    const rentings = await this.executeAsync(() =>
      this.prisma.renting.findMany({
        where: {
          organizationId: input.organizationId,
          ...(input.postingId ? { postingId: input.postingId } : {}),
        },
        orderBy: [{ startAt: "asc" }, { createdAt: "desc" }],
        include: {
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
          dispute: true,
        },
      }),
    );

    return rentings.map((renting) => this.mapRenting(renting));
  }

  async updateInstructions(
    input: UpdateRentingInstructionsInput,
  ): Promise<RentingRecord | null> {
    const renting = await this.executeAsync(async () => {
      const updated = await this.prisma.renting.update({
        where: {
          id: input.rentingId,
        },
        data: {
          pickupInstructions: input.pickupInstructions,
          returnInstructions: input.returnInstructions,
        },
        include: {
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
          dispute: true,
        },
      });

      return updated;
    }).catch((error) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        return null;
      }

      throw error;
    });

    return renting ? this.mapRenting(renting) : null;
  }

  async markCheckInReady(
    rentingId: string,
    now: Date,
  ): Promise<RentingRecord | null> {
    return this.executeAsync(async () => {
      const renting = await this.prisma.renting.findUnique({
        where: {
          id: rentingId,
        },
        include: {
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
          dispute: true,
        },
      });

      if (!renting) {
        return null;
      }

      if (renting.status !== "confirmed") {
        throw new BadRequestError(
          "Only confirmed rentings can be marked as check-in ready.",
        );
      }

      if (!renting.pickupInstructions || !renting.returnInstructions) {
        throw new BadRequestError(
          "Pickup and return instructions are required before check-in is ready.",
        );
      }

      const updated = await this.prisma.renting.update({
        where: {
          id: rentingId,
        },
        data: {
          status: "check_in_ready",
          checkInReadyAt: renting.checkInReadyAt ?? now,
        },
        include: {
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
          dispute: true,
        },
      });

      return this.mapRenting(updated);
    });
  }

  async markCheckInComplete(
    rentingId: string,
    now: Date,
  ): Promise<RentingRecord | null> {
    return this.executeAsync(async () => {
      const renting = await this.prisma.renting.findUnique({
        where: {
          id: rentingId,
        },
        include: {
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
          dispute: true,
        },
      });

      if (!renting) {
        return null;
      }

      if (!["confirmed", "check_in_ready"].includes(renting.status)) {
        throw new BadRequestError("Only upcoming rentings can be checked in.");
      }

      const updated = await this.prisma.renting.update({
        where: {
          id: rentingId,
        },
        data: {
          status: "active",
          checkInReadyAt: renting.checkInReadyAt ?? now,
          checkInCompletedAt: now,
          returnDueAt: null,
        },
        include: {
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
          dispute: true,
        },
      });

      return this.mapRenting(updated);
    });
  }

  async markCompleted(
    rentingId: string,
    now: Date,
  ): Promise<RentingRecord | null> {
    return this.executeAsync(async () => {
      const renting = await this.prisma.renting.findUnique({
        where: {
          id: rentingId,
        },
        include: {
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
          dispute: true,
        },
      });

      if (!renting) {
        return null;
      }

      if (!["active", "return_due"].includes(renting.status)) {
        throw new BadRequestError(
          "Only active or return-due rentings can be completed.",
        );
      }

      const updated = await this.prisma.renting.update({
        where: {
          id: rentingId,
        },
        data: {
          status: "completed",
          returnDueAt:
            renting.status === "active" && renting.endAt <= now
              ? (renting.returnDueAt ?? now)
              : renting.returnDueAt,
          completedAt: now,
        },
        include: {
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
          dispute: true,
        },
      });

      return this.mapRenting(updated);
    });
  }

  async createDispute(
    input: CreateRentingDisputeInput,
    now: Date,
  ): Promise<RentingRecord | null> {
    return this.executeAsync(async () => {
      const renting = await this.prisma.renting.findUnique({
        where: {
          id: input.rentingId,
        },
        include: {
          posting: {
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          },
          dispute: true,
        },
      });

      if (!renting) {
        return null;
      }

      if (renting.dispute) {
        throw new ConflictError(
          "A dispute has already been opened for this renting.",
        );
      }

      const updated = await this.prisma.$transaction(async (transaction) => {
        await transaction.rentingDispute.create({
          data: {
            id: randomUUID(),
            rentingId: input.rentingId,
            openedByUserId: input.actorUserId,
            reason: input.reason,
            details: input.details ?? null,
            createdAt: now,
          },
        });

        return transaction.renting.update({
          where: {
            id: input.rentingId,
          },
          data: {
            status: "disputed",
            disputedAt: now,
          },
          include: {
            posting: {
              include: {
                photos: {
                  orderBy: {
                    position: "asc",
                  },
                },
              },
            },
            dispute: true,
          },
        });
      });

      return this.mapRenting(updated);
    });
  }

  async hasOverlap(
    postingId: string,
    startAt: Date,
    endAt: Date,
    excludeRentingId?: string,
  ): Promise<boolean> {
    const match = await this.executeAsync(() =>
      this.prisma.renting.findFirst({
        where: {
          postingId,
          status: {
            not: "cancelled",
          },
          ...(excludeRentingId
            ? {
                id: {
                  not: excludeRentingId,
                },
              }
            : {}),
          startAt: {
            lt: endAt,
          },
          endAt: {
            gt: startAt,
          },
        },
        select: {
          id: true,
        },
      }),
    );

    return Boolean(match);
  }

  async hasEligibleReviewRenting(input: {
    postingId: string;
    renterId: string;
    now: Date;
  }): Promise<boolean> {
    const match = await this.executeAsync(() =>
      this.prisma.renting.findFirst({
        where: {
          postingId: input.postingId,
          renterId: input.renterId,
          status: "completed",
          completedAt: {
            lte: input.now,
          },
          dispute: null,
        },
        select: {
          id: true,
        },
      }),
    );

    return Boolean(match);
  }

  private mapRenting(renting: RentingPersistence): RentingRecord {
    return {
      id: renting.id,
      postingId: renting.postingId,
      bookingRequestId: renting.bookingRequestId,
      renterId: renting.renterId,
      organizationId: renting.organizationId,
      status: renting.status as RentingStatus,
      startAt: renting.startAt.toISOString(),
      endAt: renting.endAt.toISOString(),
      durationDays: renting.durationDays,
      guestCount: renting.guestCount,
      pricingCurrency: renting.pricingCurrency,
      pricingSnapshot: renting.pricingSnapshot as PostingPricing,
      dailyPriceAmount: Number(renting.dailyPriceAmount),
      estimatedTotal: Number(renting.estimatedTotal),
      confirmedAt: renting.confirmedAt.toISOString(),
      pickupInstructions: renting.pickupInstructions ?? undefined,
      returnInstructions: renting.returnInstructions ?? undefined,
      checkInReadyAt: renting.checkInReadyAt?.toISOString(),
      checkInCompletedAt: renting.checkInCompletedAt?.toISOString(),
      returnDueAt: renting.returnDueAt?.toISOString(),
      completedAt: renting.completedAt?.toISOString(),
      disputedAt: renting.disputedAt?.toISOString(),
      cancelledAt: renting.cancelledAt?.toISOString(),
      createdAt: renting.createdAt.toISOString(),
      updatedAt: renting.updatedAt.toISOString(),
      posting: {
        id: renting.posting.id,
        name: renting.posting.name,
        primaryPhotoUrl: renting.posting.photos[0]?.blobUrl,
      },
      dispute: renting.dispute ? this.mapDispute(renting.dispute) : undefined,
    };
  }

  private mapDispute(dispute: {
    id: string;
    rentingId: string;
    openedByUserId: string;
    reason: string;
    details: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): RentingDisputeRecord {
    return {
      id: dispute.id,
      rentingId: dispute.rentingId,
      openedByUserId: dispute.openedByUserId,
      reason: dispute.reason,
      details: dispute.details ?? undefined,
      createdAt: dispute.createdAt.toISOString(),
      updatedAt: dispute.updatedAt.toISOString(),
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
