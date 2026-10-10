import { Prisma } from "@/generated/prisma/client";
import { MediaRepository } from "@/features/media/media.repository";
import { testUuid } from "../../support/uuid";

const MEDIA_1_ID = testUuid(9000, 994270);
const USER_1_ID = testUuid(9000, 994271);
const CREATED_AT = new Date("2026-09-19T12:00:00.000Z");
const VARIANTS = {
  medium: { width: 800, height: 600, sizeBytes: 5000 },
  thumbnail: { width: 300, height: 225, sizeBytes: 900 },
};

function mediaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MEDIA_1_ID,
    userId: USER_1_ID,
    status: "pending_upload",
    scope: "postings",
    originalBlobName: `quarantine/images/${USER_1_ID}/${MEDIA_1_ID}`,
    processedBlobName: null,
    declaredContentType: "image/png",
    detectedContentType: null,
    originalFilename: "photo.png",
    originalEtag: null,
    sizeBytes: null,
    width: null,
    height: null,
    rejectionReason: null,
    rejectionCode: null,
    processingRequeues: 0,
    processingAttempts: 0,
    processingStartedAt: null,
    processingCompletedAt: null,
    processingError: null,
    scanStatus: "not_scanned",
    scanEngine: null,
    scannedAt: null,
    threatName: null,
    moderationResult: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function createRepository(media: Record<string, jest.Mock>) {
  return new MediaRepository({ media } as any);
}

describe("MediaRepository", () => {
  it("reads stored renditions back, and treats a malformed value as none", async () => {
    const findUnique = jest.fn();
    const repository = createRepository({ findUnique });

    for (const [stored, expected] of [
      [VARIANTS, VARIANTS],
      // A rendition the image was too narrow for is recorded as null.
      [
        { medium: null, thumbnail: VARIANTS.thumbnail },
        { medium: null, thumbnail: VARIANTS.thumbnail },
      ],
      [
        { medium: null, thumbnail: null },
        { medium: null, thumbnail: null },
      ],
      [null, null],
      [[], null],
      ["x", null],
      [{ medium: VARIANTS.medium }, null],
      [{ medium: VARIANTS.medium, thumbnail: { width: "300" } }, null],
      [{ medium: [], thumbnail: VARIANTS.thumbnail }, null],
    ] as const) {
      findUnique.mockResolvedValueOnce(mediaRow({ variants: stored }));

      expect((await repository.findById(MEDIA_1_ID))?.variants).toEqual(
        expected,
      );
    }
  });

  it("looks up the recorded renditions of ready rows by processed name", async () => {
    const findMany = jest.fn(async () => [
      {
        processedBlobName: "media/images/u1/a.webp",
        width: 1600,
        height: 1200,
        variants: VARIANTS,
      },
      {
        processedBlobName: "media/images/u1/b.webp",
        width: 120,
        height: 90,
        variants: null,
      },
    ]);
    const repository = createRepository({ findMany });

    const recorded = await repository.findRecordedRenditions([
      "media/images/u1/a.webp",
      "media/images/u1/b.webp",
      "media/images/u1/missing.webp",
    ]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "ready",
          processedBlobName: {
            in: [
              "media/images/u1/a.webp",
              "media/images/u1/b.webp",
              "media/images/u1/missing.webp",
            ],
          },
        },
      }),
    );
    expect(recorded).toEqual(
      new Map([
        [
          "media/images/u1/a.webp",
          { width: 1600, height: 1200, variants: VARIANTS },
        ],
        ["media/images/u1/b.webp", { width: 120, height: 90, variants: null }],
      ]),
    );
  });

  it("skips the query when there is nothing to look up", async () => {
    const findMany = jest.fn();
    const repository = createRepository({ findMany });

    await expect(repository.findRecordedRenditions([])).resolves.toEqual(
      new Map(),
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it("creates a pending upload and maps the row", async () => {
    const create = jest.fn(async () => mediaRow());
    const repository = createRepository({ create });

    const record = await repository.create({
      id: MEDIA_1_ID,
      userId: USER_1_ID,
      scope: "postings",
      originalBlobName: `quarantine/images/${USER_1_ID}/${MEDIA_1_ID}`,
      declaredContentType: "image/png",
      originalFilename: "photo.png",
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: MEDIA_1_ID,
        status: "pending_upload",
        scope: "postings",
      }),
    });
    expect(record).toMatchObject({
      id: MEDIA_1_ID,
      userId: USER_1_ID,
      status: "pending_upload",
      processedBlobName: null,
      createdAt: CREATED_AT,
    });
  });

  it("looks rows up by id and by either blob name", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(mediaRow())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mediaRow({ status: "ready" }))
      .mockResolvedValueOnce(null);
    const repository = createRepository({ findUnique });

    await expect(repository.findById(MEDIA_1_ID)).resolves.toMatchObject({
      id: MEDIA_1_ID,
    });
    await expect(
      repository.findByOriginalBlobName("quarantine/images/a/b"),
    ).resolves.toBeNull();
    await expect(
      repository.findByProcessedBlobName("media/images/a/b.webp"),
    ).resolves.toMatchObject({ status: "ready" });
    await expect(repository.findById(MEDIA_1_ID)).resolves.toBeNull();

    expect(findUnique.mock.calls.map(([args]) => args.where)).toEqual([
      { id: MEDIA_1_ID },
      { originalBlobName: "quarantine/images/a/b" },
      { processedBlobName: "media/images/a/b.webp" },
      { id: MEDIA_1_ID },
    ]);
  });

  it("guards every transition on the current status", async () => {
    const updateMany = jest.fn(async (_args: any) => ({ count: 1 }));
    const repository = createRepository({ updateMany });

    await expect(
      repository.markUploaded(MEDIA_1_ID, 42, '"0x8DD"'),
    ).resolves.toBe(true);
    await expect(repository.claimForProcessing(MEDIA_1_ID, 0)).resolves.toBe(
      true,
    );
    await expect(
      repository.markReady(MEDIA_1_ID, 1, {
        processedBlobName: "media/images/u/m.webp",
        detectedContentType: "image/png",
        sizeBytes: 10,
        width: 4,
        height: 3,
        variants: VARIANTS,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.markRejected(
        MEDIA_1_ID,
        "x".repeat(600),
        "type_mismatch",
        "image/jpeg",
      ),
    ).resolves.toBe(true);
    await repository.markRejected(MEDIA_1_ID, "bad", "corrupt");

    const calls: any[] = updateMany.mock.calls.map(([args]) => args);

    expect(calls[0]).toEqual({
      where: { id: MEDIA_1_ID, status: { in: ["pending_upload"] } },
      data: { status: "uploaded", sizeBytes: 42, originalEtag: '"0x8DD"' },
    });
    // A claim applies only while no other attempt has claimed the row since
    // the caller read it.
    expect(calls[1].where).toEqual({
      id: MEDIA_1_ID,
      status: { in: ["uploaded", "processing"] },
      processingAttempts: 0,
    });
    // Every claim is counted and timed in the same guarded update, and
    // clears the previous attempt's scan and moderation result.
    expect(calls[1].data).toEqual({
      status: "processing",
      processingAttempts: { increment: 1 },
      processingStartedAt: expect.any(Date),
      scanStatus: "not_scanned",
      scanEngine: null,
      scannedAt: null,
      threatName: null,
      moderationResult: Prisma.DbNull,
    });
    // Only the latest attempt, and only once its scan passed and it recorded
    // a moderation result, can make the item ready.
    expect(calls[2]).toEqual({
      where: {
        id: MEDIA_1_ID,
        status: { in: ["processing"] },
        processingAttempts: 1,
        scanStatus: { in: ["clean", "skipped"] },
        moderationResult: { path: "$.decision", equals: "allow" },
      },
      data: {
        status: "ready",
        processedBlobName: "media/images/u/m.webp",
        detectedContentType: "image/png",
        sizeBytes: 10,
        width: 4,
        height: 3,
        variants: VARIANTS,
        rejectionReason: null,
        rejectionCode: null,
        processingCompletedAt: expect.any(Date),
      },
    });
    // A ready row can never be rejected after the fact.
    expect(calls[3].where.status).toEqual({
      in: ["pending_upload", "uploaded", "processing"],
    });
    expect(calls[3].data.rejectionReason).toHaveLength(500);
    expect(calls[3].data.detectedContentType).toBe("image/jpeg");
    expect(calls[3].data.rejectionCode).toBe("type_mismatch");
    expect(calls[4].data).toEqual({
      status: "rejected",
      rejectionReason: "bad",
      rejectionCode: "corrupt",
      processingCompletedAt: expect.any(Date),
    });
  });

  it("records a scan only for the item's latest attempt", async () => {
    const updateMany = jest.fn(async (_args: any) => ({ count: 1 }));
    const repository = createRepository({ updateMany });

    await expect(
      repository.recordScanResult(MEDIA_1_ID, 2, {
        status: "infected",
        engine: `ClamAV ${"1".repeat(60)}`,
        threatName: "T".repeat(300),
      }),
    ).resolves.toBe(true);
    await repository.recordScanResult(MEDIA_1_ID, 2, {
      status: "skipped",
      engine: "none",
      threatName: null,
    });

    const calls: any[] = updateMany.mock.calls.map(([args]) => args);

    expect(calls[0].where).toEqual({
      id: MEDIA_1_ID,
      status: { in: ["processing"] },
      processingAttempts: 2,
    });
    // Cut to fit their columns.
    expect(calls[0].data).toEqual({
      scanStatus: "infected",
      scanEngine: expect.stringMatching(/^ClamAV 1+$/),
      scannedAt: expect.any(Date),
      threatName: "T".repeat(255),
    });
    expect(calls[0].data.scanEngine).toHaveLength(50);
    expect(calls[1].data).toMatchObject({
      scanStatus: "skipped",
      scanEngine: "none",
      threatName: null,
    });
  });

  it("reads the scan columns back", async () => {
    const scannedAt = new Date("2026-10-04T12:00:00.000Z");
    const repository = createRepository({
      findUnique: jest.fn(async () =>
        mediaRow({
          status: "rejected",
          scanStatus: "infected",
          scanEngine: "ClamAV 1.5.4/28137",
          scannedAt,
          threatName: "Eicar-Test-Signature",
        }),
      ),
    });

    await expect(repository.findById(MEDIA_1_ID)).resolves.toMatchObject({
      scanStatus: "infected",
      scanEngine: "ClamAV 1.5.4/28137",
      scannedAt,
      threatName: "Eicar-Test-Signature",
    });
  });

  it("records a moderation result only for the item's latest attempt", async () => {
    const updateMany = jest.fn(async (_args: any) => ({ count: 1 }));
    const repository = createRepository({ updateMany });
    const result = {
      decision: "block" as const,
      categories: { hate: 0, sexual: 0, violence: 6, selfHarm: 0 },
      provider: "azure-content-safety",
    };

    await expect(
      repository.recordModerationResult(MEDIA_1_ID, 3, result),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: MEDIA_1_ID,
        status: { in: ["processing"] },
        processingAttempts: 3,
      },
      data: { moderationResult: result },
    });
  });

  it("reads a moderation result back, and treats a malformed value as none", async () => {
    const findUnique = jest.fn();
    const repository = createRepository({ findUnique });
    const result = {
      decision: "allow",
      categories: { hate: 0, sexual: 2, violence: 0, selfHarm: 0 },
      provider: "azure-content-safety",
    };

    for (const [stored, expected] of [
      [result, result],
      // Unknown categories and non-numeric severities are dropped.
      [
        {
          ...result,
          categories: { hate: 2, sexual: "4", weapons: 6 },
        },
        { ...result, categories: { hate: 2 } },
      ],
      [
        { decision: "allow", categories: {}, provider: "none" },
        { decision: "allow", categories: {}, provider: "none" },
      ],
      [null, null],
      [[], null],
      ["allow", null],
      [{ ...result, decision: "review" }, null],
      [{ ...result, provider: 1 }, null],
      [{ ...result, categories: null }, null],
      [{ ...result, categories: [] }, null],
    ] as const) {
      findUnique.mockResolvedValueOnce(mediaRow({ moderationResult: stored }));

      expect((await repository.findById(MEDIA_1_ID))?.moderationResult).toEqual(
        expected,
      );
    }
  });

  it("reports a transition that lost the race", async () => {
    const repository = createRepository({
      updateMany: jest.fn(async () => ({ count: 0 })),
    });

    await expect(repository.markUploaded(MEDIA_1_ID, 1, null)).resolves.toBe(
      false,
    );
  });

  describe("deleteIfUnattached", () => {
    const PROCESSED = `media/images/${USER_1_ID}/${MEDIA_1_ID}.webp`;
    const READY = mediaRow({ status: "ready", processedBlobName: PROCESSED });

    type Lock = { id: string; name: string | null };

    // Each transaction's locking read finds the next of `locks`; the
    // reference lookup that follows finds `attached`.
    function createDeletingRepository(options: {
      row: ReturnType<typeof mediaRow> | null;
      locks: Lock[][];
      attached?: boolean;
    }) {
      const queries: Array<{ sql: string; values: unknown[] }> = [];
      const locks = [...options.locks];
      const queryRaw = jest.fn(async (query: { sql: string; values: [] }) => {
        queries.push(query);
        return query.sql.includes("FOR UPDATE")
          ? (locks.shift() ?? [])
          : options.attached
            ? [{ name: PROCESSED }]
            : [];
      });
      const media = {
        findUnique: jest.fn(async () => options.row),
        delete: jest.fn(async () => options.row),
      };
      const transactions = jest.fn(async (run: (tx: unknown) => unknown) =>
        run({ $queryRaw: queryRaw, media }),
      );
      const repository = new MediaRepository({
        media,
        $transaction: transactions,
      } as any);

      return { repository, media, queries, transactions };
    }

    it("locks a processed image through its name, as the guard does, then deletes it", async () => {
      const { repository, media, queries } = createDeletingRepository({
        row: READY,
        locks: [[{ id: MEDIA_1_ID, name: PROCESSED }]],
      });

      await expect(
        repository.deleteIfUnattached({ id: MEDIA_1_ID }),
      ).resolves.toMatchObject({
        outcome: "deleted",
        record: { id: MEDIA_1_ID, processedBlobName: PROCESSED },
      });

      const [lock, references] = queries;
      expect(lock!.sql).toContain("WHERE processed_blob_name = ? FOR UPDATE");
      expect(lock!.values).toEqual([PROCESSED]);
      expect(references!.sql).toContain("UNION ALL");
      expect(media.delete).toHaveBeenCalledWith({ where: { id: MEDIA_1_ID } });
    });

    it("keeps a row whose image a save attached first", async () => {
      const { repository, media } = createDeletingRepository({
        row: READY,
        locks: [[{ id: MEDIA_1_ID, name: PROCESSED }]],
        attached: true,
      });

      await expect(
        repository.deleteIfUnattached({ processedBlobName: PROCESSED }),
      ).resolves.toMatchObject({ outcome: "attached" });
      expect(media.delete).not.toHaveBeenCalled();
    });

    it("locks an unprocessed row by id, and deletes it without looking for references", async () => {
      const { repository, media, queries } = createDeletingRepository({
        row: mediaRow(),
        locks: [[{ id: MEDIA_1_ID, name: null }]],
      });

      await expect(
        repository.deleteIfUnattached({ id: MEDIA_1_ID }),
      ).resolves.toMatchObject({ outcome: "deleted" });

      expect(queries).toHaveLength(1);
      expect(queries[0]!.sql).toContain("WHERE id = ? FOR UPDATE");
      expect(media.delete).toHaveBeenCalled();
    });

    it("locks again by name when the row became ready before the lock", async () => {
      const { repository, media, queries, transactions } =
        createDeletingRepository({
          row: mediaRow(),
          locks: [
            [{ id: MEDIA_1_ID, name: PROCESSED }],
            [{ id: MEDIA_1_ID, name: PROCESSED }],
          ],
        });
      media.findUnique
        .mockResolvedValueOnce(mediaRow())
        .mockResolvedValue(READY);

      await expect(
        repository.deleteIfUnattached({ id: MEDIA_1_ID }),
      ).resolves.toMatchObject({ outcome: "deleted" });

      expect(transactions).toHaveBeenCalledTimes(2);
      expect(queries[0]!.sql).toContain("WHERE id = ? FOR UPDATE");
      expect(queries[1]!.sql).toContain(
        "WHERE processed_blob_name = ? FOR UPDATE",
      );
    });

    it("reports a row that is already gone", async () => {
      const missingRow = createDeletingRepository({ row: null, locks: [] });
      await expect(
        missingRow.repository.deleteIfUnattached({ id: MEDIA_1_ID }),
      ).resolves.toEqual({ outcome: "missing" });
      expect(missingRow.transactions).not.toHaveBeenCalled();

      const unlocked = createDeletingRepository({ row: READY, locks: [[]] });
      await expect(
        unlocked.repository.deleteIfUnattached({ id: MEDIA_1_ID }),
      ).resolves.toEqual({ outcome: "missing" });
      expect(unlocked.media.delete).not.toHaveBeenCalled();
    });
  });

  it("lists cleanup candidates by status and age, oldest first, never a ready row", async () => {
    const findMany = jest.fn(async (_args: any) => [
      mediaRow({ status: "processing" }),
    ]);
    const repository = createRepository({ findMany });
    const cutoff = new Date("2026-09-20T12:00:00.000Z");

    await expect(
      repository.listAbandonedUploads(cutoff, 10),
    ).resolves.toMatchObject([{ id: MEDIA_1_ID, status: "processing" }]);
    await repository.listStuck(cutoff, 20);
    await repository.listRejected(cutoff, 30);

    expect(findMany.mock.calls.map(([args]) => args)).toEqual([
      {
        where: { status: "pending_upload", createdAt: { lt: cutoff } },
        orderBy: { createdAt: "asc" },
        take: 10,
      },
      {
        where: {
          status: { in: ["uploaded", "processing"] },
          updatedAt: { lt: cutoff },
        },
        orderBy: { updatedAt: "asc" },
        take: 20,
      },
      {
        where: { status: "rejected", updatedAt: { lt: cutoff } },
        orderBy: { updatedAt: "asc" },
        take: 30,
      },
    ]);
  });

  it("claims a stuck row only while it is still waiting and unmoved, and counts the re-queue", async () => {
    const updateMany = jest.fn(async (_args: any) => ({ count: 1 }));
    const repository = createRepository({ updateMany });
    const cutoff = new Date("2026-09-20T12:00:00.000Z");
    const claimedAt = new Date("2026-09-20T12:15:00.000Z");

    await expect(
      repository.claimStuckForRequeue(MEDIA_1_ID, cutoff, claimedAt),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: MEDIA_1_ID,
        status: { in: ["uploaded", "processing"] },
        updatedAt: { lt: cutoff },
      },
      data: { updatedAt: claimedAt, processingRequeues: { increment: 1 } },
    });

    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      repository.claimStuckForRequeue(MEDIA_1_ID, cutoff, claimedAt),
    ).resolves.toBe(false);
  });

  it("changes cleanup rows only while they are in the state they were selected in", async () => {
    const updateMany = jest.fn(async (_args: any) => ({ count: 1 }));
    const repository = createRepository({ updateMany });
    const cutoff = new Date("2026-09-20T12:00:00.000Z");
    const at = new Date("2026-09-20T12:15:00.000Z");

    await expect(
      repository.rejectStuck(
        MEDIA_1_ID,
        cutoff,
        "x".repeat(600),
        "processing_failed",
        at,
      ),
    ).resolves.toBe(true);
    await expect(
      repository.rejectAbandonedUpload(
        MEDIA_1_ID,
        cutoff,
        "abandoned",
        "abandoned",
        at,
      ),
    ).resolves.toBe(true);
    await expect(
      repository.deferRejectedPurge(MEDIA_1_ID, cutoff, at),
    ).resolves.toBe(true);
    await expect(repository.recordProcessingProgress(MEDIA_1_ID)).resolves.toBe(
      true,
    );

    const calls: any[] = updateMany.mock.calls.map(([args]) => args);
    expect(calls.slice(0, 3)).toEqual([
      {
        where: {
          id: MEDIA_1_ID,
          status: { in: ["uploaded", "processing"] },
          updatedAt: { lt: cutoff },
        },
        // Truncated like every other rejection.
        data: {
          status: "rejected",
          rejectionReason: "x".repeat(500),
          rejectionCode: "processing_failed",
          processingCompletedAt: at,
          updatedAt: at,
        },
      },
      {
        where: {
          id: MEDIA_1_ID,
          status: { in: ["pending_upload"] },
          createdAt: { lt: cutoff },
        },
        data: {
          status: "rejected",
          rejectionReason: "abandoned",
          rejectionCode: "abandoned",
          processingCompletedAt: at,
          updatedAt: at,
        },
      },
      {
        where: {
          id: MEDIA_1_ID,
          status: { in: ["rejected"] },
          updatedAt: { lt: cutoff },
        },
        data: { updatedAt: at },
      },
    ]);
    expect(calls[3].where).toEqual({
      id: MEDIA_1_ID,
      status: { in: ["processing"] },
    });
    expect(calls[3].data.updatedAt).toBeInstanceOf(Date);

    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      repository.rejectStuck(
        MEDIA_1_ID,
        cutoff,
        "stuck",
        "processing_failed",
        at,
      ),
    ).resolves.toBe(false);
  });

  it("records a processing failure only on an unfinished row, cut to fit", async () => {
    const updateMany = jest.fn(async (_args: any) => ({ count: 1 }));
    const repository = createRepository({ updateMany });

    await expect(
      repository.recordProcessingFailure(
        MEDIA_1_ID,
        new TypeError("x".repeat(2000)),
      ),
    ).resolves.toBe(true);
    await repository.recordProcessingFailure(MEDIA_1_ID, "plain string");

    const calls: any[] = updateMany.mock.calls.map(([args]) => args);
    expect(calls[0].where).toEqual({
      id: MEDIA_1_ID,
      status: { in: ["uploaded", "processing"] },
    });
    expect(calls[0].data.processingError).toHaveLength(1000);
    expect(calls[0].data.processingError).toMatch(/^TypeError: x+$/);
    expect(calls[1].data).toEqual({
      processingError: "Non-error thrown: plain string",
    });
  });

  it("reopens only a row rejected because processing kept failing, within its retention", async () => {
    const updateMany = jest.fn(async (_args: any) => ({ count: 1 }));
    const repository = createRepository({ updateMany });
    const rejectedAfter = new Date("2026-09-28T12:00:00.000Z");

    await expect(
      repository.reopenForReplay(MEDIA_1_ID, rejectedAfter),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: MEDIA_1_ID,
        status: { in: ["rejected"] },
        rejectionCode: "processing_failed",
        updatedAt: { gt: rejectedAfter },
      },
      // A fresh re-queue budget, so the media cleanup does not reject the
      // replayed item at its first stuck sweep.
      data: {
        status: "uploaded",
        rejectionReason: null,
        rejectionCode: null,
        processingCompletedAt: null,
        processingRequeues: 0,
      },
    });

    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      repository.reopenForReplay(MEDIA_1_ID, rejectedAfter),
    ).resolves.toBe(false);
  });

  it("lists processing failures within their retention, paged by id", async () => {
    const findMany = jest.fn(async (_args: any) => [
      mediaRow({ status: "rejected", rejectionCode: "processing_failed" }),
    ]);
    const repository = createRepository({ findMany });
    const rejectedAfter = new Date("2026-09-28T12:00:00.000Z");

    await expect(
      repository.listReplayableRejections(rejectedAfter, null, 50),
    ).resolves.toEqual([
      expect.objectContaining({ id: MEDIA_1_ID, status: "rejected" }),
    ]);
    await repository.listReplayableRejections(rejectedAfter, MEDIA_1_ID, 50);

    expect(findMany.mock.calls.map(([args]) => args)).toEqual([
      {
        where: {
          status: "rejected",
          rejectionCode: "processing_failed",
          updatedAt: { gt: rejectedAfter },
        },
        orderBy: { id: "asc" },
        take: 50,
      },
      {
        where: {
          status: "rejected",
          rejectionCode: "processing_failed",
          updatedAt: { gt: rejectedAfter },
          id: { gt: MEDIA_1_ID },
        },
        orderBy: { id: "asc" },
        take: 50,
      },
    ]);
  });

  it("claims an unfinished row for a replay only while it has not moved since its job was dead-lettered", async () => {
    const updateMany = jest.fn(async (_args: any) => ({ count: 1 }));
    const repository = createRepository({ updateMany });
    const deadLetteredAt = new Date("2026-09-29T12:00:00.000Z");
    const claimedAt = new Date("2026-09-29T12:30:00.000Z");

    await expect(
      repository.claimForReplay(MEDIA_1_ID, deadLetteredAt, claimedAt),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: MEDIA_1_ID,
        status: { in: ["uploaded", "processing"] },
        updatedAt: { lte: deadLetteredAt },
      },
      data: { updatedAt: claimedAt },
    });

    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      repository.claimForReplay(MEDIA_1_ID, deadLetteredAt, claimedAt),
    ).resolves.toBe(false);
  });

  it("deletes a row only while it is still in the expected status", async () => {
    const deleteMany = jest.fn(async (_args: any) => ({ count: 1 }));
    const repository = createRepository({ deleteMany });

    await expect(
      repository.deleteByIdIfStatus(MEDIA_1_ID, "pending_upload"),
    ).resolves.toBe(true);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: MEDIA_1_ID, status: "pending_upload" },
    });

    deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      repository.deleteByIdIfStatus(MEDIA_1_ID, "rejected"),
    ).resolves.toBe(false);
  });
  it("reports which blobs any image column still references", async () => {
    const queryRaw = jest.fn(async (_query: unknown) => [
      { name: "media/images/u/m.webp" },
    ]);
    const repository = new MediaRepository({ $queryRaw: queryRaw } as any);

    await expect(
      repository.listAttachedBlobNames([
        "media/images/u/m.webp",
        "media/images/u/free.webp",
      ]),
    ).resolves.toEqual(new Set(["media/images/u/m.webp"]));
    const [[query]] = queryRaw.mock.calls as unknown as [
      [{ sql: string; values: unknown[] }],
    ];
    for (const column of [
      "posting_photos WHERE blob_name IN",
      "profiles WHERE avatar_blob_name IN",
      "organizations WHERE logo_blob_name IN",
      "organization_blog_posts WHERE cover_image_blob_name IN",
    ]) {
      expect(query.sql).toContain(column);
    }

    await expect(repository.listAttachedBlobNames([])).resolves.toEqual(
      new Set(),
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("lists ready rows past their TTL, least recently moved first", async () => {
    const findMany = jest.fn(async (_args: any) => [
      mediaRow({ status: "ready" }),
    ]);
    const repository = createRepository({ findMany });
    const cutoff = new Date("2026-09-20T12:00:00.000Z");

    await expect(
      repository.listReadyPastTtl(cutoff, 40),
    ).resolves.toMatchObject([{ id: MEDIA_1_ID, status: "ready" }]);
    // One indexed range read on (status, updated_at), whatever the catalog.
    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "ready",
        processedBlobName: { not: null },
        updatedAt: { lt: cutoff },
      },
      orderBy: { updatedAt: "asc" },
      take: 40,
    });
  });

  it("reports which images a restorable audit entry holds, by an indexed lookup", async () => {
    const findMany = jest.fn(async (_args: unknown) => [
      { blobName: "media/images/u/logo.webp" },
    ]);
    const repository = new MediaRepository({
      organizationAuditBlobReference: { findMany },
    } as any);

    await expect(repository.listAuditHeldBlobNames([])).resolves.toEqual(
      new Set(),
    );
    expect(findMany).not.toHaveBeenCalled();

    await expect(
      repository.listAuditHeldBlobNames([
        "media/images/u/logo.webp",
        "media/images/u/free.webp",
      ]),
    ).resolves.toEqual(new Set(["media/images/u/logo.webp"]));
    expect(findMany).toHaveBeenCalledWith({
      where: {
        blobName: {
          in: ["media/images/u/logo.webp", "media/images/u/free.webp"],
        },
      },
      select: { blobName: true },
      distinct: ["blobName"],
    });
  });

  it("claims or defers an unattached row only while it is still ready and unmoved", async () => {
    const updateMany = jest.fn(async (_args: unknown) => ({ count: 1 }));
    const repository = createRepository({ updateMany });
    const cutoff = new Date("2026-09-20T12:00:00.000Z");
    const at = new Date("2026-09-21T12:00:00.000Z");

    await expect(
      repository.claimUnattached(MEDIA_1_ID, cutoff, "too late", at),
    ).resolves.toBe(true);
    await expect(
      repository.deferUnattached([MEDIA_1_ID], cutoff, at),
    ).resolves.toBe(1);
    await expect(repository.deferUnattached([], cutoff, at)).resolves.toBe(0);

    expect(updateMany.mock.calls.map(([args]) => args)).toEqual([
      {
        where: {
          id: MEDIA_1_ID,
          status: { in: ["ready"] },
          updatedAt: { lt: cutoff },
        },
        data: {
          status: "rejected",
          rejectionReason: "too late",
          rejectionCode: "unattached",
          processingCompletedAt: at,
          updatedAt: at,
        },
      },
      {
        where: {
          id: { in: [MEDIA_1_ID] },
          status: "ready",
          updatedAt: { lt: cutoff },
        },
        data: { updatedAt: at },
      },
    ]);
  });
});
