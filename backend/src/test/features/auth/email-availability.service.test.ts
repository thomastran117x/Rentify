import { EmailAvailabilityService } from "@/features/auth/email-availability/email-availability.service";
import type { PendingLocalSignupRecord } from "@/features/auth/pending-signup/pending-signup.store";
import { asUuid } from "@/configuration/validation/uuid";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";

function createService(
  overrides: {
    findUserIdByEmail?: () => Promise<string | null>;
    pendingSignup?: PendingLocalSignupRecord | null;
    bloomVerdict?: "definitely-absent" | "possibly-present" | "unknown";
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
  // Defaults to "unknown" so every case exercises the authoritative path unless
  // it opts into the fast one.
  const emailBloomService = {
    check: jest.fn(() => overrides.bloomVerdict ?? "unknown"),
    add: jest.fn(async () => undefined),
  };

  const service = new EmailAvailabilityService(
    usersRepository as never,
    emailBloomService as never,
    pendingSignupStore as never,
  );

  return { service, usersRepository, pendingSignupStore, emailBloomService };
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
          createdAt: new Date().toISOString(),
        },
      });

      await expect(
        service.isEmailAvailable("casey@example.com"),
      ).resolves.toMatchObject({ available: false, reason: "taken" });
    });
  });

  describe("resolveEmailAvailabilityHint", () => {
    it("answers from the filter without touching the database", async () => {
      const { service, usersRepository, pendingSignupStore } = createService({
        bloomVerdict: "definitely-absent",
      });

      await expect(
        service.resolveEmailAvailabilityHint("nobody@example.com"),
      ).resolves.toEqual({
        email: "nobody@example.com",
        available: true,
        reason: null,
      });
      expect(usersRepository.findUserIdByEmail).not.toHaveBeenCalled();
      expect(pendingSignupStore.read).not.toHaveBeenCalled();
    });

    it("falls through when the filter cannot rule the address out", async () => {
      // A false positive has to cost a query rather than a wrong answer.
      const { service, usersRepository } = createService({
        bloomVerdict: "possibly-present",
        findUserIdByEmail: async () => "someone-else",
      });

      await expect(
        service.resolveEmailAvailabilityHint("casey@example.com"),
      ).resolves.toMatchObject({ available: false, reason: "taken" });
      expect(usersRepository.findUserIdByEmail).toHaveBeenCalled();
    });

    it("falls through when the filter is unready or stale", async () => {
      // `unknown` restores exactly the behaviour this filter replaced.
      const { service, usersRepository } = createService({
        bloomVerdict: "unknown",
      });

      await expect(
        service.resolveEmailAvailabilityHint("casey@example.com"),
      ).resolves.toMatchObject({ available: true, reason: null });
      expect(usersRepository.findUserIdByEmail).toHaveBeenCalled();
    });

    it("checks the filter with the normalized address", async () => {
      // The filter stores normalized values, so checking a raw one would miss.
      const { service, emailBloomService } = createService({
        bloomVerdict: "definitely-absent",
      });

      await service.resolveEmailAvailabilityHint(" Casey@Example.com ");

      expect(emailBloomService.check).toHaveBeenCalledWith("casey@example.com");
    });

    it("does not report a pending signup as untouched", async () => {
      // This is why pending reservations are in the filter at all: without
      // them the fast path would answer `reason: null` for an address whose
      // signup is already in flight.
      const { service } = createService({
        bloomVerdict: "possibly-present",
        pendingSignup: {
          username: "casey-doe",
          email: "casey@example.com",
          passwordHash: "hash",
          createdAt: new Date().toISOString(),
        },
      });

      await expect(
        service.resolveEmailAvailabilityHint("casey@example.com"),
      ).resolves.toMatchObject({
        available: true,
        reason: "pending-verification",
      });
    });
  });
});
