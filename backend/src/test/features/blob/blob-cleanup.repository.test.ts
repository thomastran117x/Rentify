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
      profile: {
        findMany: jest.fn(async () => [
          { avatarBlobName: processed("avatar") },
        ]),
      },
      organization: {
        findMany: jest.fn(async () => [{ logoBlobName: processed("logo") }]),
      },
      organizationBlogPost: {
        findMany: jest.fn(async () => [
          { coverImageBlobName: processed("cover") },
        ]),
      },
      postingPhoto: {
        findMany: jest.fn(async () => [
          {
            blobName: processed("photo"),
            thumbnailBlobName: "media/images/owner-1/thumbnails/photo.webp",
          },
        ]),
      },
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
      profile: {
        findMany: jest.fn(async () => [
          { avatarBlobName: "profiles/user/avatar.png" },
        ]),
      },
      organization: {
        findMany: jest.fn(async () => [
          { logoBlobName: " organizations/user/logo.png " },
        ]),
      },
      organizationBlogPost: {
        findMany: jest.fn(async () => [
          { coverImageBlobName: "organizations/user/blog/cover.jpg" },
        ]),
      },
      postingPhoto: {
        findMany: jest.fn(async () => [
          {
            blobName: "postings/user/photo.jpg",
            thumbnailBlobName: "postings/user/thumbnails/photo.webp",
          },
          {
            blobName: "postings/user/photo.jpg",
            thumbnailBlobName: null,
          },
        ]),
      },
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
      ]),
    );
    expect(result.sourceCounts).toEqual({
      profiles: 1,
      organizations: 1,
      blogPosts: 1,
      postingPhotos: 2,
      auditSnapshots: 3,
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
    const olderThan = new Date("2026-09-18T12:00:00.000Z");

    await expect(
      repository.deleteAbandonedMedia({
        deletedBlobNames: ["quarantine/images/u/m"],
        olderThan,
      }),
    ).resolves.toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            originalBlobName: { in: ["quarantine/images/u/m"] },
            status: { not: "ready" },
          },
          { processedBlobName: { in: ["quarantine/images/u/m"] } },
          { status: { not: "ready" }, updatedAt: { lte: olderThan } },
        ],
      },
    });
  });
});
