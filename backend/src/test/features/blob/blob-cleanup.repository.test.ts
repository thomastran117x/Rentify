import { BlobCleanupRepository } from "@/features/blob/blob-cleanup.repository";

describe("BlobCleanupRepository", () => {
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
});
