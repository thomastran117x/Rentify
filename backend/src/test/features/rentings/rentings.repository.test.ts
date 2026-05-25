import { Prisma } from "@prisma/client";
import ConflictError from "@/errors/http/conflict.error";
import { RentingsRepository } from "@/features/rentings/rentings.repository";

describe("RentingsRepository", () => {
  it("maps a duplicate bookingRequestId unique constraint to ConflictError", async () => {
    const error = Object.assign(new Error("duplicate renting"), {
      code: "P2002",
      clientVersion: "test",
    });
    Object.setPrototypeOf(
      error,
      Prisma.PrismaClientKnownRequestError.prototype,
    );

    const database = {
      $transaction: async () => {
        throw error;
      },
    };

    const repository = new RentingsRepository(database as never);

    await expect(
      repository.convertApprovedBookingRequest("booking-1", "owner-1"),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("queries for a completed non-disputed renting when checking review eligibility", async () => {
    const now = new Date("2026-04-23T12:00:00.000Z");
    const findFirst = jest.fn(async () => ({
      id: "renting-1",
    }));
    const database = {
      renting: {
        findFirst,
      },
    };
    const repository = new RentingsRepository(database as never);

    const result = await repository.hasEligibleReviewRenting({
      postingId: "posting-1",
      renterId: "renter-1",
      now,
    });

    expect(result).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        postingId: "posting-1",
        renterId: "renter-1",
        status: "completed",
        completedAt: {
          lte: now,
        },
        dispute: null,
      },
      select: {
        id: true,
      },
    });
  });
});
