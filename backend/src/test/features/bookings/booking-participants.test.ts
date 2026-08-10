import ForbiddenError from "@/errors/http/forbidden.error";
import { resolveBookingParticipant } from "@/features/bookings/booking-participants";
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

  return {
    service: {
      requireMembership,
      assertCanManage,
    } as unknown as OrganizationAccessService,
    requireMembership,
    assertCanManage,
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
    const { service, assertCanManage } = createAccessService({
      role: "manager",
    });

    await expect(
      resolveBookingParticipant(service, bookingRequest, "manager-1", "manage"),
    ).resolves.toBe("owner");

    expect(assertCanManage).toHaveBeenCalledWith(
      { organizationId: "org-1", role: "manager" },
      "You do not have permission to manage this booking request.",
    );
  });

  it("propagates the forbidden error when the member cannot manage", async () => {
    const manageError = new ForbiddenError(
      "You do not have permission to manage this booking request.",
    );
    const { service } = createAccessService({ role: "operator", manageError });

    await expect(
      resolveBookingParticipant(
        service,
        bookingRequest,
        "operator-1",
        "manage",
      ),
    ).rejects.toBe(manageError);
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
