import type { CacheService } from "@/features/cache/cache.service";
import type { EmailService } from "@/features/email/email.service";
import type { OrganizationAuditService } from "@/features/organizations/organization-audit.service";
import type { OrganizationsRepository } from "@/features/organizations/organizations.repository";
import type {
  PostingExpiryCandidate,
  PostingRecord,
} from "@/features/postings/postings.model";
import { PostingExpiryService } from "@/features/postings/posting-expiry.service";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function buildCandidate(
  overrides: Partial<PostingExpiryCandidate> = {},
): PostingExpiryCandidate {
  return {
    id: "posting-1",
    organizationId: "org-1",
    name: "Lakeside cabin",
    expiresAt: "2026-08-18T23:59:59.999Z",
    ...overrides,
  };
}

function buildPaused(id = "posting-1"): PostingRecord {
  return {
    id,
    organizationId: "org-1",
    status: "paused",
    name: "Lakeside cabin",
  } as PostingRecord;
}

class FakeRepository {
  dueCandidates: PostingExpiryCandidate[] = [];
  reminderCandidates: PostingExpiryCandidate[] = [];
  expireResults = new Map<string, PostingRecord | null>();
  expireCalls: string[] = [];
  markCalls: string[] = [];
  markResult = true;
  lastReminderWindow: Date | null = null;

  async listPostingsDueForExpiry(limit: number) {
    return this.dueCandidates.slice(0, limit);
  }

  async listPostingsDueForExpiryReminder(limit: number, windowEndsAt: Date) {
    this.lastReminderWindow = windowEndsAt;
    return this.reminderCandidates.slice(0, limit);
  }

  async expireIfDue(id: string) {
    this.expireCalls.push(id);
    return this.expireResults.get(id) ?? null;
  }

  async markExpiryReminderSent(id: string) {
    this.markCalls.push(id);
    return this.markResult;
  }
}

class FakeCacheService {
  acquired: string[] = [];
  released = 0;
  failKeys = new Set<string>();

  async acquireLock(key: string) {
    if (this.failKeys.has(key)) {
      return null;
    }

    this.acquired.push(key);
    return {
      release: async () => {
        this.released += 1;
      },
    };
  }
}

class FakePublicCacheService {
  invalidated: string[] = [];

  async invalidatePublic(postingId: string) {
    this.invalidated.push(postingId);
  }
}

class FakeAuditService {
  records: Array<Record<string, unknown>> = [];
  shouldThrow = false;

  async record(input: Record<string, unknown>) {
    if (this.shouldThrow) {
      throw new Error("audit sink unavailable");
    }

    this.records.push(input);
  }
}

class FakeOrganizationsRepository {
  primaryManagerId: string | null = "user-1";

  async findPrimaryManagerUserId() {
    return this.primaryManagerId;
  }
}

class FakeEmailService {
  sent: Array<Record<string, unknown>> = [];

  async sendPostingExpiringSoonEmail(input: Record<string, unknown>) {
    this.sent.push(input);
  }
}

function createService() {
  const repository = new FakeRepository();
  const publicCache = new FakePublicCacheService();
  const cache = new FakeCacheService();
  const audit = new FakeAuditService();
  const organizations = new FakeOrganizationsRepository();
  const email = new FakeEmailService();

  const service = new PostingExpiryService(
    repository as unknown as PostingsRepository,
    publicCache as unknown as PostingsPublicCacheService,
    cache as unknown as CacheService,
    audit as unknown as OrganizationAuditService,
    organizations as unknown as OrganizationsRepository,
    email as unknown as EmailService,
  );

  return {
    service,
    repository,
    publicCache,
    cache,
    audit,
    organizations,
    email,
  };
}

describe("PostingExpiryService.expireDuePostings", () => {
  it("pauses a due posting, invalidates its projection and records a system audit entry", async () => {
    const { service, repository, publicCache, cache, audit } = createService();
    const candidate = buildCandidate();
    repository.dueCandidates = [candidate];
    repository.expireResults.set(candidate.id, buildPaused());

    const processed = await service.expireDuePostings(10);

    expect(processed).toBe(1);
    expect(repository.expireCalls).toEqual([candidate.id]);
    expect(publicCache.invalidated).toEqual([candidate.id]);
    expect(cache.acquired).toEqual(["posting:posting-1:booking-window"]);
    expect(cache.released).toBe(1);
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]).toMatchObject({
      action: "posting.expired",
      organizationId: "org-1",
      resourceType: "posting",
      resourceId: candidate.id,
      // The sweeper is the system, not a user.
      actorUserId: null,
      // Restoring would republish a posting the sweeper immediately re-pauses.
      restorable: false,
    });
  });

  it("does nothing beyond the attempt when the posting is no longer due", async () => {
    const { service, repository, publicCache, audit } = createService();
    repository.dueCandidates = [buildCandidate()];
    repository.expireResults.set("posting-1", null);

    const processed = await service.expireDuePostings(10);

    expect(processed).toBe(1);
    expect(publicCache.invalidated).toEqual([]);
    expect(audit.records).toEqual([]);
  });

  it("keeps processing the batch when one posting fails", async () => {
    const { service, repository, publicCache } = createService();
    repository.dueCandidates = [
      buildCandidate({ id: "posting-1" }),
      buildCandidate({ id: "posting-2" }),
    ];
    repository.expireResults.set("posting-2", buildPaused("posting-2"));
    const originalExpire = repository.expireIfDue.bind(repository);
    repository.expireIfDue = async (id: string) => {
      if (id === "posting-1") {
        throw new Error("deadlock");
      }

      return originalExpire(id);
    };

    const processed = await service.expireDuePostings(10);

    expect(processed).toBe(2);
    expect(publicCache.invalidated).toEqual(["posting-2"]);
  });

  it("does not abort the batch when the flow lock is held", async () => {
    const { service, repository, cache, publicCache } = createService();
    repository.dueCandidates = [
      buildCandidate({ id: "posting-1" }),
      buildCandidate({ id: "posting-2" }),
    ];
    repository.expireResults.set("posting-2", buildPaused("posting-2"));
    cache.failKeys.add("posting:posting-1:booking-window");

    const processed = await service.expireDuePostings(10);

    expect(processed).toBe(2);
    expect(repository.expireCalls).toEqual(["posting-2"]);
    expect(publicCache.invalidated).toEqual(["posting-2"]);
  });

  it("still completes the transition when the audit sink fails", async () => {
    const { service, repository, publicCache, audit } = createService();
    repository.dueCandidates = [buildCandidate()];
    repository.expireResults.set("posting-1", buildPaused());
    audit.shouldThrow = true;

    await expect(service.expireDuePostings(10)).resolves.toBe(1);
    expect(publicCache.invalidated).toEqual(["posting-1"]);
  });
});

describe("PostingExpiryService.sendDueExpiryReminders", () => {
  it("claims the reminder before enqueuing the email", async () => {
    const { service, repository, email } = createService();
    const candidate = buildCandidate();
    repository.reminderCandidates = [candidate];

    const processed = await service.sendDueExpiryReminders(10, 3);

    expect(processed).toBe(1);
    expect(repository.markCalls).toEqual([candidate.id]);
    expect(email.sent).toEqual([
      {
        postingId: candidate.id,
        recipientId: "user-1",
        expiresAt: candidate.expiresAt,
      },
    ]);
  });

  it("queries the lead window relative to now", async () => {
    const { service, repository } = createService();
    const before = Date.now();

    await service.sendDueExpiryReminders(10, 3);

    const window = repository.lastReminderWindow;
    expect(window).not.toBeNull();
    expect((window as Date).getTime()).toBeGreaterThanOrEqual(
      before + 3 * DAY_IN_MS,
    );
  });

  it("sends nothing when another sweep already claimed the reminder", async () => {
    const { service, repository, email } = createService();
    repository.reminderCandidates = [buildCandidate()];
    repository.markResult = false;

    await service.sendDueExpiryReminders(10, 3);

    expect(email.sent).toEqual([]);
  });

  it("stamps and skips when the organization has no primary manager", async () => {
    const { service, repository, organizations, email } = createService();
    repository.reminderCandidates = [buildCandidate()];
    organizations.primaryManagerId = null;

    await service.sendDueExpiryReminders(10, 3);

    // Stamped anyway: leaving the latch open would re-select this orphaned row
    // on every poll.
    expect(repository.markCalls).toEqual(["posting-1"]);
    expect(email.sent).toEqual([]);
  });

  it("keeps processing the batch when one reminder fails", async () => {
    const { service, repository, email } = createService();
    repository.reminderCandidates = [
      buildCandidate({ id: "posting-1" }),
      buildCandidate({ id: "posting-2" }),
    ];
    const originalSend = email.sendPostingExpiringSoonEmail.bind(email);
    email.sendPostingExpiringSoonEmail = async (
      input: Record<string, unknown>,
    ) => {
      if (input.postingId === "posting-1") {
        throw new Error("broker unavailable");
      }

      return originalSend(input);
    };

    const processed = await service.sendDueExpiryReminders(10, 3);

    expect(processed).toBe(2);
    expect(email.sent).toHaveLength(1);
  });
});
