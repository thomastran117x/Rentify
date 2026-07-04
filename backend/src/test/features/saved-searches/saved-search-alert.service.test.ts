import { SavedSearchAlertService } from "@/features/saved-searches/saved-search-alert.service";

function makePosting(overrides: Record<string, unknown> = {}) {
  return {
    id: "posting-1",
    name: "Sony FX6 Cinema Camera",
    city: "Vancouver",
    family: "equipment",
    subtype: "camera",
    tags: ["cinema", "sony"],
    pricing: { daily: 150 },
    publishedAt: new Date("2026-06-28T00:00:00.000Z"),
    ...overrides,
  };
}

function makeSavedSearch(overrides: Record<string, unknown> = {}) {
  return {
    id: "ss-1",
    userId: "user-1",
    name: "Cinema Cameras",
    searchParams: { family: "equipment" },
    alertEnabled: true,
    lastAlertSentAt: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    user: {
      email: "renter@example.com",
      firstName: "Alex",
    },
    ...overrides,
  };
}

function createService(overrides: {
  repository?: Record<string, unknown>;
  emailService?: Record<string, unknown>;
} = {}) {
  const repository = {
    findAlertBatch: jest.fn(async () => [makeSavedSearch()]),
    findNewMatchingPostings: jest.fn(async () => [makePosting()]),
    markAlertSent: jest.fn(async () => undefined),
    ...overrides.repository,
  };

  const emailService = {
    sendSavedSearchAlertEmail: jest.fn(async () => undefined),
    ...overrides.emailService,
  };

  const service = new SavedSearchAlertService(
    repository as never,
    emailService as never,
  );

  return { service, repository, emailService };
}

describe("SavedSearchAlertService", () => {
  describe("processBatch", () => {
    it("returns 0 without any work when the batch is empty", async () => {
      const { service, repository, emailService } = createService({
        repository: { findAlertBatch: jest.fn(async () => []) },
      });

      const count = await service.processBatch(50);

      expect(count).toBe(0);
      expect(repository.findNewMatchingPostings).not.toHaveBeenCalled();
      expect(emailService.sendSavedSearchAlertEmail).not.toHaveBeenCalled();
    });

    it("sends an alert email and marks the search when new matches are found", async () => {
      const { service, repository, emailService } = createService();

      const count = await service.processBatch(50);

      expect(count).toBe(1);
      expect(emailService.sendSavedSearchAlertEmail).toHaveBeenCalledWith({
        to: "renter@example.com",
        firstName: "Alex",
        searchName: "Cinema Cameras",
        postings: [
          {
            id: "posting-1",
            name: "Sony FX6 Cinema Camera",
            city: "Vancouver",
            postingPath: "/postings/posting-1",
          },
        ],
      });
      expect(repository.markAlertSent).toHaveBeenCalledWith(
        "ss-1",
        expect.any(Date),
      );
    });

    it("skips email and markAlertSent when no new postings match", async () => {
      const { service, repository, emailService } = createService({
        repository: {
          findNewMatchingPostings: jest.fn(async () => []),
        },
      });

      await service.processBatch(50);

      expect(emailService.sendSavedSearchAlertEmail).not.toHaveBeenCalled();
      expect(repository.markAlertSent).not.toHaveBeenCalled();
    });

    it("uses createdAt as publishedSince when lastAlertSentAt is null", async () => {
      const { service, repository } = createService({
        repository: {
          findAlertBatch: jest.fn(async () => [
            makeSavedSearch({
              lastAlertSentAt: null,
              createdAt: new Date("2026-06-01T00:00:00.000Z"),
            }),
          ]),
        },
      });

      await service.processBatch(50);

      expect(repository.findNewMatchingPostings).toHaveBeenCalledWith(
        expect.anything(),
        new Date("2026-06-01T00:00:00.000Z"),
        expect.any(Number),
      );
    });

    it("uses lastAlertSentAt as publishedSince when set", async () => {
      const sentAt = new Date("2026-06-20T00:00:00.000Z");
      const { service, repository } = createService({
        repository: {
          findAlertBatch: jest.fn(async () => [
            makeSavedSearch({ lastAlertSentAt: sentAt }),
          ]),
        },
      });

      await service.processBatch(50);

      expect(repository.findNewMatchingPostings).toHaveBeenCalledWith(
        expect.anything(),
        sentAt,
        expect.any(Number),
      );
    });

    it("filters out postings that do not include all required tags", async () => {
      const { service, emailService } = createService({
        repository: {
          findAlertBatch: jest.fn(async () => [
            makeSavedSearch({
              searchParams: { tags: ["4k", "cinema"] },
            }),
          ]),
          findNewMatchingPostings: jest.fn(async () => [
            makePosting({ tags: ["cinema", "sony"] }),
            makePosting({ id: "posting-2", tags: ["4k", "cinema", "sony"] }),
          ]),
        },
      });

      await service.processBatch(50);

      const callArg = (
        emailService.sendSavedSearchAlertEmail.mock
          .calls[0] as [{ postings: { id: string }[] }]
      )[0];
      expect(callArg.postings).toHaveLength(1);
      expect(callArg.postings[0]?.id).toBe("posting-2");
    });

    it("filters out postings below minDailyPrice", async () => {
      const { service, emailService } = createService({
        repository: {
          findAlertBatch: jest.fn(async () => [
            makeSavedSearch({ searchParams: { minDailyPrice: 200 } }),
          ]),
          findNewMatchingPostings: jest.fn(async () => [
            makePosting({ pricing: { daily: 150 } }),
            makePosting({ id: "posting-2", pricing: { daily: 250 } }),
          ]),
        },
      });

      await service.processBatch(50);

      const callArg = (
        emailService.sendSavedSearchAlertEmail.mock
          .calls[0] as [{ postings: { id: string }[] }]
      )[0];
      expect(callArg.postings).toHaveLength(1);
      expect(callArg.postings[0]?.id).toBe("posting-2");
    });

    it("filters out postings above maxDailyPrice", async () => {
      const { service, emailService } = createService({
        repository: {
          findAlertBatch: jest.fn(async () => [
            makeSavedSearch({ searchParams: { maxDailyPrice: 100 } }),
          ]),
          findNewMatchingPostings: jest.fn(async () => [
            makePosting({ pricing: { daily: 150 } }),
            makePosting({ id: "posting-2", pricing: { daily: 80 } }),
          ]),
        },
      });

      await service.processBatch(50);

      const callArg = (
        emailService.sendSavedSearchAlertEmail.mock
          .calls[0] as [{ postings: { id: string }[] }]
      )[0];
      expect(callArg.postings).toHaveLength(1);
      expect(callArg.postings[0]?.id).toBe("posting-2");
    });

    it("caps the email at 5 matched postings", async () => {
      const postings = Array.from({ length: 8 }, (_, i) =>
        makePosting({ id: `posting-${i + 1}` }),
      );
      const { service, emailService } = createService({
        repository: {
          findNewMatchingPostings: jest.fn(async () => postings),
        },
      });

      await service.processBatch(50);

      const callArg = (
        emailService.sendSavedSearchAlertEmail.mock
          .calls[0] as [{ postings: unknown[] }]
      )[0];
      expect(callArg.postings).toHaveLength(5);
    });

    it("silently skips entries with unparseable searchParams", async () => {
      const { service, emailService } = createService({
        repository: {
          findAlertBatch: jest.fn(async () => [
            makeSavedSearch({ searchParams: { family: "boat" } }),
          ]),
        },
      });

      await expect(service.processBatch(50)).resolves.not.toThrow();
      expect(emailService.sendSavedSearchAlertEmail).not.toHaveBeenCalled();
    });

    it("processes all entries in the batch and returns the batch size", async () => {
      const batch = [
        makeSavedSearch({ id: "ss-1" }),
        makeSavedSearch({ id: "ss-2", user: { email: "b@example.com", firstName: null } }),
      ];
      const { service, repository } = createService({
        repository: {
          findAlertBatch: jest.fn(async () => batch),
          findNewMatchingPostings: jest.fn(async () => [makePosting()]),
        },
      });

      const count = await service.processBatch(50);

      expect(count).toBe(2);
      expect(repository.markAlertSent).toHaveBeenCalledTimes(2);
    });
  });
});
