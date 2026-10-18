import { containerTokens } from "@/configuration/bootstrap/container";
import { AuthAuditRetentionService } from "@/features/auth/audit/auth-audit-retention.service";
import type { AuthAuditRepository } from "@/features/auth/audit/auth-audit.repository";
import {
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-10-17T12:00:00.000Z");
const RETENTION_DAYS = 180;

// Ages, relative to NOW, of the seeded rows. The cutoff is exactly 180 days
// back; a row created at the cutoff is not older than it and stays.
const SEEDED_ROWS = [
  { id: "00000000-0000-4000-8000-000000000001", ageMs: 400 * DAY_MS },
  { id: "00000000-0000-4000-8000-000000000002", ageMs: 181 * DAY_MS },
  { id: "00000000-0000-4000-8000-000000000003", ageMs: 180 * DAY_MS + 1_000 },
  { id: "00000000-0000-4000-8000-000000000004", ageMs: 180 * DAY_MS + 1 },
  { id: "00000000-0000-4000-8000-000000000005", ageMs: 180 * DAY_MS },
  { id: "00000000-0000-4000-8000-000000000006", ageMs: 179 * DAY_MS },
  { id: "00000000-0000-4000-8000-000000000007", ageMs: 0 },
];
const EXPIRED_IDS = SEEDED_ROWS.slice(0, 4).map((row) => row.id);
const KEPT_IDS = SEEDED_ROWS.slice(4).map((row) => row.id);

describe("Auth audit retention persistence integration", () => {
  let persistenceApp: PersistenceTestApp;

  function createService(): AuthAuditRetentionService {
    return new AuthAuditRetentionService(
      persistenceApp.container.resolve<AuthAuditRepository>(
        containerTokens.authAuditRepository,
      ),
      () => NOW,
    );
  }

  async function remainingIds(): Promise<string[]> {
    const rows = await persistenceApp.prisma.authAuditEvent.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return rows.map((row) => row.id);
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
    await persistenceApp.prisma.authAuditEvent.deleteMany();
    await persistenceApp.prisma.authAuditEvent.createMany({
      data: SEEDED_ROWS.map((row) => ({
        id: row.id,
        eventType: "login.succeeded",
        outcome: "success",
        ipAddress: "203.0.113.7",
        userAgent: "Mozilla/5.0",
        createdAt: new Date(NOW.getTime() - row.ageMs),
      })),
    });
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("deletes the rows older than the retention period in batches", async () => {
    const summary = await createService().prune({
      retentionDays: RETENTION_DAYS,
      batchSize: 3,
    });

    expect(summary).toEqual({
      cutoff: new Date(NOW.getTime() - RETENTION_DAYS * DAY_MS),
      deleted: EXPIRED_IDS.length,
      batches: 2,
    });
    await expect(remainingIds()).resolves.toEqual(KEPT_IDS);
  });

  it("deletes nothing on a second run", async () => {
    const service = createService();
    await service.prune({ retentionDays: RETENTION_DAYS, batchSize: 3 });

    await expect(
      service.prune({ retentionDays: RETENTION_DAYS, batchSize: 3 }),
    ).resolves.toMatchObject({ deleted: 0, batches: 0 });
    await expect(remainingIds()).resolves.toEqual(KEPT_IDS);
  });

  it("deletes each expired row once when replicas prune at the same time", async () => {
    const summaries = await Promise.all([
      createService().prune({ retentionDays: RETENTION_DAYS, batchSize: 1 }),
      createService().prune({ retentionDays: RETENTION_DAYS, batchSize: 1 }),
    ]);

    expect(summaries[0]!.deleted + summaries[1]!.deleted).toBe(
      EXPIRED_IDS.length,
    );
    await expect(remainingIds()).resolves.toEqual(KEPT_IDS);
  });
});
