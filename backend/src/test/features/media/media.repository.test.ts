import { MediaRepository } from "@/features/media/media.repository";
import { testUuid } from "../../support/uuid";

const MEDIA_1_ID = testUuid(9000, 994270);
const USER_1_ID = testUuid(9000, 994271);
const CREATED_AT = new Date("2026-09-19T12:00:00.000Z");

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
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function createRepository(media: Record<string, jest.Mock>) {
  return new MediaRepository({ media } as any);
}

describe("MediaRepository", () => {
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
    await expect(repository.claimForProcessing(MEDIA_1_ID)).resolves.toBe(true);
    await expect(
      repository.markReady(MEDIA_1_ID, {
        processedBlobName: "media/images/u/m.webp",
        detectedContentType: "image/png",
        sizeBytes: 10,
        width: 4,
        height: 3,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.markRejected(MEDIA_1_ID, "x".repeat(600), "image/jpeg"),
    ).resolves.toBe(true);
    await repository.markRejected(MEDIA_1_ID, "bad");

    const calls: any[] = updateMany.mock.calls.map(([args]) => args);

    expect(calls[0]).toEqual({
      where: { id: MEDIA_1_ID, status: { in: ["pending_upload"] } },
      data: { status: "uploaded", sizeBytes: 42, originalEtag: '"0x8DD"' },
    });
    expect(calls[1].where.status).toEqual({ in: ["uploaded", "processing"] });
    expect(calls[2]).toEqual({
      where: { id: MEDIA_1_ID, status: { in: ["processing"] } },
      data: {
        status: "ready",
        processedBlobName: "media/images/u/m.webp",
        detectedContentType: "image/png",
        sizeBytes: 10,
        width: 4,
        height: 3,
        rejectionReason: null,
      },
    });
    // A ready row can never be rejected after the fact.
    expect(calls[3].where.status).toEqual({
      in: ["pending_upload", "uploaded", "processing"],
    });
    expect(calls[3].data.rejectionReason).toHaveLength(500);
    expect(calls[3].data.detectedContentType).toBe("image/jpeg");
    expect(calls[4].data).toEqual({
      status: "rejected",
      rejectionReason: "bad",
    });
  });

  it("reports a transition that lost the race", async () => {
    const repository = createRepository({
      updateMany: jest.fn(async () => ({ count: 0 })),
    });

    await expect(repository.markUploaded(MEDIA_1_ID, 1, null)).resolves.toBe(
      false,
    );
  });

  it("deletes by id without failing on a missing row", async () => {
    const deleteMany = jest.fn(async () => ({ count: 0 }));
    const repository = createRepository({ deleteMany });

    await repository.deleteById(MEDIA_1_ID);

    expect(deleteMany).toHaveBeenCalledWith({ where: { id: MEDIA_1_ID } });
  });
  it("reports whether any feature table still references a blob", async () => {
    const zero = jest.fn(async (_args: unknown) => 0);
    const repository = new MediaRepository({
      postingPhoto: { count: zero },
      profile: { count: zero },
      organization: { count: jest.fn(async (_args: unknown) => 1) },
      organizationBlogPost: { count: zero },
    } as any);

    await expect(
      repository.isBlobAttached("media/images/u/m.webp"),
    ).resolves.toBe(true);
    expect(zero.mock.calls.map(([args]) => args)).toEqual([
      { where: { blobName: "media/images/u/m.webp" } },
      { where: { avatarBlobName: "media/images/u/m.webp" } },
      { where: { coverImageBlobName: "media/images/u/m.webp" } },
    ]);

    const unattached = new MediaRepository({
      postingPhoto: { count: zero },
      profile: { count: zero },
      organization: { count: zero },
      organizationBlogPost: { count: zero },
    } as any);
    await expect(
      unattached.isBlobAttached("media/images/u/m.webp"),
    ).resolves.toBe(false);
  });
});
