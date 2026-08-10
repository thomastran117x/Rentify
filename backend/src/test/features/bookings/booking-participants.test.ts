import ForbiddenError from "@/errors/http/forbidden.error";
import {
  resolveBookingParticipant,
  resolveBookingParticipantAccess,
} from "@/features/bookings/booking-participants";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";

const bookingRequest = {
  renterId: "renter-1",
  organizationId: "org-1",
};

function createAccessService(options?: {
  role?: string;
  membershipError?: Error;
  manageError?: Error;
}) {
  const requireMembership = jest.fn(async () => {
    if (options?.membershipError) {
      throw options.membershipError;
    }

    return { organizationId: "org-1", role: options?.role ?? "manager" };
  });
  const assertCanManage = jest.fn(() => {
    if (options?.manageError) {
      throw options.manageError;
    }
  });

  const canManage = jest.fn(
    (role: string) => role === "primary_manager" || role === "manager",
  );

  return {
    service: {
      requireMembership,
      assertCanManage,
      canManage,
    } as unknown as OrganizationAccessService,
    requireMembership,
    assertCanManage,
    canManage,
  };
}

describe("resolveBookingParticipant", () => {
  it("resolves the renter without consulting organization membership", async () => {
    const { service, requireMembership, assertCanManage } =
      createAccessService();

    await expect(
      resolveBookingParticipant(service, bookingRequest, "renter-1", "manage"),
    ).resolves.toBe("renter");

    // Renter-first precedence: a user who is both the renter and an
    // organization manager must never be resolved as the owner side.
    expect(requireMembership).not.toHaveBeenCalled();
    expect(assertCanManage).not.toHaveBeenCalled();
  });

  it("resolves any organization member as the owner side for read access", async () => {
    const { service, requireMembership, assertCanManage } = createAccessService(
      {
        role: "operator",
      },
    );

    await expect(
      resolveBookingParticipant(service, bookingRequest, "operator-1", "read"),
    ).resolves.toBe("owner");

    expect(requireMembership).toHaveBeenCalledWith(
      "operator-1",
      "org-1",
      "You do not have access to this booking request.",
    );
    expect(assertCanManage).not.toHaveBeenCalled();
  });

  it("requires a manager role for manage access", async () => {
    const { service, canManage } = createAccessService({
      role: "manager",
    });

    await expect(
      resolveBookingParticipant(service, bookingRequest, "manager-1", "manage"),
    ).resolves.toBe("owner");

    expect(canManage).toHaveBeenCalledWith("manager");
  });

  it("rejects a member who cannot manage", async () => {
    const { service } = createAccessService({ role: "operator" });

    await expect(
      resolveBookingParticipant(
        service,
        bookingRequest,
        "operator-1",
        "manage",
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: "You do not have permission to manage this booking request.",
    });
  });

  it("reports manage capability without throwing for a read-only member", async () => {
    const { service, assertCanManage } = createAccessService({
      role: "operator",
    });

    await expect(
      resolveBookingParticipantAccess(service, bookingRequest, "operator-1"),
    ).resolves.toEqual({ side: "owner", canManage: false });

    // The capability query must never throw; only the asserting wrapper does.
    expect(assertCanManage).not.toHaveBeenCalled();
  });

  it("reports manage capability for a manager and for the renter", async () => {
    const manager = createAccessService({ role: "manager" });
    await expect(
      resolveBookingParticipantAccess(
        manager.service,
        bookingRequest,
        "manager-1",
      ),
    ).resolves.toEqual({ side: "owner", canManage: true });

    const renter = createAccessService();
    await expect(
      resolveBookingParticipantAccess(
        renter.service,
        bookingRequest,
        "renter-1",
      ),
    ).resolves.toEqual({ side: "renter", canManage: true });
  });

  it("resolves membership against the booking organization, not an active one", async () => {
    // A manager of several organizations keeps write access on a booking owned
    // by any of them, so the lookup is keyed by the booking's organization.
    const { service, requireMembership } = createAccessService({
      role: "manager",
    });

    await resolveBookingParticipantAccess(service, bookingRequest, "manager-1");

    expect(requireMembership).toHaveBeenCalledWith(
      "manager-1",
      "org-1",
      "You do not have access to this booking request.",
    );
  });

  it("propagates the forbidden error for a non-member", async () => {
    const membershipError = new ForbiddenError(
      "You do not have access to this booking request.",
    );
    const { service } = createAccessService({ membershipError });

    await expect(
      resolveBookingParticipant(service, bookingRequest, "outsider-1", "read"),
    ).rejects.toBe(membershipError);
  });
});
