import { BlobCleanupRepository } from "@/features/blob/blob-cleanup.repository";

describe("BlobCleanupRepository", () => {
  it("keeps every rendition of a referenced processed image", async () => {
    const processed = (id: string) => `media/images/owner-1/${id}.webp`;
    const renditions = (id: string) => [
      processed(id),
      `media/images/owner-1/${id}.medium.webp`,
      `media/images/owner-1/${id}.thumbnail.webp`,
    ];
    const database = {
      $queryRaw: jest.fn(async () => [
        { source: "profiles", name: processed("avatar") },
        { source: "organizations", name: processed("logo") },
        { source: "blogPosts", name: processed("cover") },
        { source: "postingPhotos", name: processed("photo") },
        {
          source: "postingPhotos",
          name: "media/images/owner-1/thumbnails/photo.webp",
        },
      ]),
      organizationAuditLog: {
        findMany: jest.fn(async () => [
          {
            resourceType: "organization",
            beforeSnapshot: { logoBlobName: processed("old-logo") },
            afterSnapshot: null,
          },
          {
            resourceType: "posting",
            beforeSnapshot: { photos: [{ blobName: processed("old-photo") }] },
            afterSnapshot: null,
          },
        ]),
      },
      media: { findMany: jest.fn(async () => []) },
    };
    const repository = new BlobCleanupRepository(database as never);

    const result = await repository.loadReferences();

    expect(result.blobNames).toEqual(
      new Set([
        ...renditions("avatar"),
        ...renditions("logo"),
        ...renditions("cover"),
        ...renditions("photo"),
        // The posting crop is its own image, with no renditions.
        "media/images/owner-1/thumbnails/photo.webp",
        ...renditions("old-logo"),
        ...renditions("old-photo"),
      ]),
    );
  });

  it("collects every direct and restorable audit blob reference", async () => {
    const database = {
      $queryRaw: jest.fn(async (_query: unknown) => [
        { source: "profiles", name: "profiles/user/avatar.png" },
        { source: "organizations", name: " organizations/user/logo.png " },
        { source: "blogPosts", name: "organizations/user/blog/cover.jpg" },
        { source: "postingPhotos", name: "postings/user/photo.jpg" },
        {
          source: "postingPhotos",
          name: "postings/user/thumbnails/photo.webp",
        },
        { source: "postingPhotos", name: "postings/user/photo.jpg" },
      ]),
      organizationAuditLog: {
        findMany: jest.fn(async () => [
          {
            resourceType: "organization",
            beforeSnapshot: { logoBlobName: "organizations/user/old.png" },
            afterSnapshot: { logoBlobName: "" },
          },
          {
            resourceType: "posting",
            beforeSnapshot: {
              photos: [
                {
                  blobName: "postings/user/former-photo.jpg",
                  thumbnailBlobName:
                    "postings/user/thumbnails/former-photo.webp",
                },
              ],
            },
            afterSnapshot: {
              photos: [
                {
                  blobName: "postings/user/replacement-photo.jpg",
                  thumbnailBlobName: null,
                },
                null,
              ],
            },
          },
          {
            resourceType: "posting",
            beforeSnapshot: { photos: "invalid" },
            afterSnapshot: [],
          },
        ]),
      },
      media: {
        findMany: jest.fn(async () => [
          { originalBlobName: "quarantine/images/user/waiting" },
          { originalBlobName: "quarantine/images/user/failed" },
        ]),
      },
    };
    const repository = new BlobCleanupRepository(database as never);

    const result = await repository.loadReferences();

    expect(result.blobNames).toEqual(
      new Set([
        "profiles/user/avatar.png",
        "organizations/user/logo.png",
        "organizations/user/blog/cover.jpg",
        "postings/user/photo.jpg",
        "postings/user/thumbnails/photo.webp",
        "organizations/user/old.png",
        "postings/user/former-photo.jpg",
        "postings/user/thumbnails/former-photo.webp",
        "postings/user/replacement-photo.jpg",
        "quarantine/images/user/waiting",
        "quarantine/images/user/failed",
      ]),
    );
    expect(result.sourceCounts).toEqual({
      profiles: 1,
      organizations: 1,
      blogPosts: 1,
      postingPhotos: 3,
      auditSnapshots: 3,
      mediaUploads: 2,
    });
    // Every image column in the registry is read, in one round trip.
    const [[query]] = database.$queryRaw.mock.calls as unknown as [
      [{ sql: string }],
    ];
    for (const column of [
      "avatar_blob_name",
      "logo_blob_name",
      "cover_image_blob_name",
      "blob_name",
      "thumbnail_blob_name",
    ]) {
      expect(query.sql).toContain(`${column} IS NOT NULL`);
    }
    // An upload still waiting on processing, or kept by a processing failure
    // for a replay, is the media cleanup worker's to delete, whatever its age.
    expect(database.media.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { status: { in: ["uploaded", "processing"] } },
          { status: "rejected", rejectionCode: "processing_failed" },
        ],
      },
      select: { originalBlobName: true },
    });
    expect(database.organizationAuditLog.findMany).toHaveBeenCalledWith({
      where: {
        resourceType: { in: ["organization", "posting"] },
        restorable: true,
      },
      select: {
        resourceType: true,
        beforeSnapshot: true,
        afterSnapshot: true,
      },
    });
  });
  it("deletes media rows left without an image, never a ready row whose leftover upload was cleaned", async () => {
    const deleteMany = jest.fn(async (_args: unknown) => ({ count: 3 }));
    const repository = new BlobCleanupRepository({
      media: { deleteMany },
    } as any);

    await expect(
      repository.deleteAbandonedMedia({
        deletedBlobNames: ["quarantine/images/u/m"],
      }),
    ).resolves.toBe(3);
    // Only rows whose blob was deleted: age alone is the media cleanup
    // worker's concern.
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            originalBlobName: { in: ["quarantine/images/u/m"] },
            status: { not: "ready" },
          },
          { processedBlobName: { in: ["quarantine/images/u/m"] } },
        ],
      },
    });
  });
});
