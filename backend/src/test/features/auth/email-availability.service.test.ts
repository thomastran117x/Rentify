import { EmailAvailabilityService } from "@/features/auth/email-availability/email-availability.service";
import type { PendingLocalSignupRecord } from "@/features/auth/pending-signup/pending-signup.store";
import { asUuid } from "@/configuration/validation/uuid";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";

function createService(
  overrides: {
    findUserIdByEmail?: () => Promise<string | null>;
    pendingSignup?: PendingLocalSignupRecord | null;
    pendingEmailChangeOwnerId?: string | null;
    addressHeld?: boolean;
  } = {},
) {
  const usersRepository = {
    findUserIdByEmail: jest.fn(
      overrides.findUserIdByEmail ?? (async () => null as string | null),
    ),
  };
  const pendingSignupStore = {
    read: jest.fn(async () => overrides.pendingSignup ?? null),
  };
  const emailChangeStore = {
    readAddressHolder: jest.fn(
      async () => overrides.pendingEmailChangeOwnerId ?? null,
    ),
  };
  const emailChangeRevertRepository = {
    isAddressHeld: jest.fn(async () => overrides.addressHeld ?? false),
  };

  const service = new EmailAvailabilityService(
    usersRepository as never,
    pendingSignupStore as never,
    emailChangeStore as never,
    emailChangeRevertRepository as never,
  );

  return {
    service,
    usersRepository,
    pendingSignupStore,
    emailChangeStore,
    emailChangeRevertRepository,
  };
}

describe("EmailAvailabilityService", () => {
  describe("isEmailAvailable", () => {
    it("reports an unclaimed address as available", async () => {
      const { service } = createService();

      await expect(
        service.isEmailAvailable("casey@example.com"),
      ).resolves.toEqual({
        email: "casey@example.com",
        available: true,
        reason: null,
      });
    });

    it("reports an address another account is mid-change to as taken", async () => {
      const { service } = createService({
        pendingEmailChangeOwnerId: "someone-else",
      });

      await expect(
        service.isEmailAvailable("casey@example.com"),
      ).resolves.toEqual({
        email: "casey@example.com",
        available: false,
        reason: "taken",
      });
    });

    it("reports an address held for a revert link as taken", async () => {
      const { service, emailChangeRevertRepository } = createService({
        addressHeld: true,
      });

      await expect(
        service.isEmailAvailable("Casey@Example.com", asUuid(OWNER_ID)),
      ).resolves.toEqual({
        email: "casey@example.com",
        available: false,
        reason: "taken",
      });
      expect(emailChangeRevertRepository.isAddressHeld).toHaveBeenCalledWith(
        "casey@example.com",
        asUuid(OWNER_ID),
      );
    });

    it("does not report the caller's own pending change as taken", async () => {
      const { service } = createService({
        pendingEmailChangeOwnerId: OWNER_ID,
      });

      await expect(
        service.isEmailAvailable("casey@example.com", asUuid(OWNER_ID)),
      ).resolves.toEqual({
        email: "casey@example.com",
        available: true,
        reason: null,
      });
    });

    it("reports an address another account holds as taken", async () => {
      const { service } = createService({
        findUserIdByEmail: async () => "someone-else",
      });

      await expect(
        service.isEmailAvailable("casey@example.com"),
      ).resolves.toEqual({
        email: "casey@example.com",
        available: false,
        reason: "taken",
      });
    });

    it("exempts the caller's own address", async () => {
      // A signed-in user checking the address they already hold must not be
      // told it is taken by the account they are signed in to.
      const { service } = createService({
        findUserIdByEmail: async () => OWNER_ID,
      });

      await expect(
        service.isEmailAvailable("casey@example.com", asUuid(OWNER_ID)),
      ).resolves.toEqual({
        email: "casey@example.com",
        available: true,
        reason: null,
      });
    });

    it("keeps a pending signup available but flags why", async () => {
      // `localSignup` accepts an address whose signup is unverified, so
      // reporting it unavailable would block a form the backend would accept —
      // including for the person who started that signup and came back.
      const { service } = createService({
        pendingSignup: {
          username: "casey-doe",
          email: "casey@example.com",
          passwordHash: "hash",
          dateOfBirth: "2012-06-15",
          createdAt: new Date().toISOString(),
        },
      });

      await expect(
        service.isEmailAvailable("casey@example.com"),
      ).resolves.toEqual({
        email: "casey@example.com",
        available: true,
        reason: "pending-verification",
      });
    });

    it("normalizes before it looks anything up", async () => {
      const { service, usersRepository, pendingSignupStore } = createService();

      await expect(
        service.isEmailAvailable("  Casey@Example.COM "),
      ).resolves.toMatchObject({ email: "casey@example.com" });
      expect(usersRepository.findUserIdByEmail).toHaveBeenCalledWith(
        "casey@example.com",
      );
      expect(pendingSignupStore.read).toHaveBeenCalledWith("casey@example.com");
    });

    it("prefers a claimed row over a pending reservation", async () => {
      const { service } = createService({
        findUserIdByEmail: async () => "someone-else",
        pendingSignup: {
          username: "casey-doe",
          email: "casey@example.com",
          passwordHash: "hash",
          dateOfBirth: "2012-06-15",
          createdAt: new Date().toISOString(),
        },
      });

      await expect(
        service.isEmailAvailable("casey@example.com"),
      ).resolves.toMatchObject({ available: false, reason: "taken" });
    });
  });
});
