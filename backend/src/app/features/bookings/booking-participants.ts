import ForbiddenError from "@/errors/http/forbidden.error";
import type { BookingRequestRecord } from "@/features/bookings/bookings.model";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { Uuid } from "@/configuration/validation/uuid";

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
export interface BookingParticipantAccessResult {
  side: BookingParticipantSide;
  /** Whether this participant may perform manage-level actions on the thread. */
  canManage: boolean;
}

/**
 * Resolves the actor's side together with whether they hold manage rights,
 * without throwing for a read-only member.
 *
 * Membership is checked against the *booking's* organization, not the actor's
 * currently active one — a manager of several organizations keeps their rights
 * on a booking owned by any of them.
 */
export async function resolveBookingParticipantAccess(
  organizationAccessService: OrganizationAccessService,
  bookingRequest: Pick<BookingRequestRecord, "renterId" | "organizationId">,
  userId: Uuid,
): Promise<BookingParticipantAccessResult> {
  if (bookingRequest.renterId === userId) {
    return { side: "renter", canManage: true };
  }

  const membership = await organizationAccessService.requireMembership(
    userId,
    bookingRequest.organizationId,
    "You do not have access to this booking request.",
  );

  return {
    side: "owner",
    canManage: organizationAccessService.canManage(membership.role),
  };
}

export async function resolveBookingParticipant(
  organizationAccessService: OrganizationAccessService,
  bookingRequest: Pick<BookingRequestRecord, "renterId" | "organizationId">,
  userId: Uuid,
  access: BookingParticipantAccess,
): Promise<BookingParticipantSide> {
  const { side, canManage } = await resolveBookingParticipantAccess(
    organizationAccessService,
    bookingRequest,
    userId,
  );

  if (access === "manage" && !canManage) {
    throw new ForbiddenError(
      "You do not have permission to manage this booking request.",
    );
  }

  return side;
}
