import type { BookingRequestRecord } from "@/features/bookings/bookings.model";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";

/**
 * Which side of a booking request a user acts on.
 *
 * A booking request has exactly two sides: the renter (a single user) and the
 * owner (the set of users with a membership in the booking's organization).
 * The side is derived rather than stored — `renterId` is immutable on a booking
 * request, so the derivation is stable and cannot drift from a second column.
 */
export type BookingParticipantSide = "renter" | "owner";

export type BookingParticipantAccess = "read" | "manage";

/**
 * Resolves which side of a booking request the actor is on, rejecting anyone
 * who is on neither.
 *
 * Renter-first: a user who is both the renter and an organization manager (a
 * legitimate case — organization members can rent from other organizations, and
 * seeded `user1` is exactly this) is always treated as the renter for that
 * booking. That precedence keeps the side deterministic.
 *
 * `access: "read"` admits any organization member, including `operator`, which
 * matches the bar `BookingsService.getById` already applies to the booking
 * record itself. `access: "manage"` additionally requires a manager role, which
 * is the bar every other organization-side booking mutation uses.
 */
export async function resolveBookingParticipant(
  organizationAccessService: OrganizationAccessService,
  bookingRequest: Pick<BookingRequestRecord, "renterId" | "organizationId">,
  userId: string,
  access: BookingParticipantAccess,
): Promise<BookingParticipantSide> {
  if (bookingRequest.renterId === userId) {
    return "renter";
  }

  const membership = await organizationAccessService.requireMembership(
    userId,
    bookingRequest.organizationId,
    "You do not have access to this booking request.",
  );

  if (access === "manage") {
    organizationAccessService.assertCanManage(
      membership,
      "You do not have permission to manage this booking request.",
    );
  }

  return "owner";
}
