import {
  blobCleanupExitCode,
  BlobCleanupService,
  type BlobCleanupStorage,
} from "@/features/blob/blob-cleanup.service";
import type { ManagedBlobItem } from "@/features/blob/blob.model";
import { BlobCleanupRepository } from "@/features/blob/blob-cleanup.repository";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const OLD = new Date("2026-09-07T11:59:59.000Z");
const YOUNG = new Date("2026-09-08T11:00:00.000Z");
const EMPTY_SOURCE_COUNTS = {
  profiles: 0,
  organizations: 0,
  blogPosts: 0,
  postingPhotos: 0,
  auditSnapshots: 0,
};

function createStorage(
  blobs: ManagedBlobItem[],
  failures: Set<string> = new Set(),
): BlobCleanupStorage & { deleteBlob: jest.Mock } {
  return {
    async *listAzureBlobs() {
      for (const blob of blobs) {
        yield blob;
      }
    },
    deleteBlob: jest.fn(async (blobName: string) => {
      if (failures.has(blobName)) {
        throw new Error(`Could not delete ${blobName}`);
      }
    }),
  };
}

describe("BlobCleanupService", () => {
  it("previews only old, unreferenced image blobs", async () => {
    const repository = {
      deleteAbandonedMedia: jest.fn(async () => 0),
      loadReferences: jest.fn(async () => ({
        blobNames: new Set(["referenced.png"]),
        sourceCounts: {
          profiles: 1,
          organizations: 0,
          blogPosts: 0,
          postingPhotos: 0,
          auditSnapshots: 0,
        },
      })),
    };
    const storage = createStorage([
      {
        name: "referenced.png",
        contentType: "image/png",
        lastModified: OLD,
        contentLength: 5,
      },
      {
        name: "orphan.jpg",
        contentType: "IMAGE/JPEG",
        lastModified: OLD,
        contentLength: 10,
      },
      { name: "young.png", contentType: "image/png", lastModified: YOUNG },
      { name: "notes.txt", contentType: "text/plain", lastModified: OLD },
      { name: "unknown-date.png", contentType: "image/png" },
      { name: "unknown-type", lastModified: OLD },
    ]);
    const service = new BlobCleanupService(repository, storage, () => NOW);

    const result = await service.run(false);

    expect(result).toMatchObject({
      mode: "preview",
      scanned: 6,
      referenced: 1,
      protected: 4,
      candidateCount: 1,
      candidateBytes: 10,
      deleted: 0,
      failed: 0,
    });
    expect(result.candidates).toEqual([
      {
        blobName: "orphan.jpg",
        contentLength: 10,
        lastModified: OLD.toISOString(),
      },
    ]);
    expect(repository.loadReferences).toHaveBeenCalledTimes(1);
    expect(storage.deleteBlob).not.toHaveBeenCalled();
  });

  it("refreshes references, continues after failures, and reports byte totals", async () => {
    const repository = {
      deleteAbandonedMedia: jest.fn(
        async (_input: { deletedBlobNames: string[]; olderThan: Date }) => 2,
      ),
      loadReferences: jest
        .fn()
        .mockResolvedValueOnce({
          blobNames: new Set(),
          sourceCounts: EMPTY_SOURCE_COUNTS,
        })
        .mockResolvedValueOnce({
          blobNames: new Set(["newly-referenced.png"]),
          sourceCounts: EMPTY_SOURCE_COUNTS,
        }),
    };
    const storage = createStorage(
      [
        {
          name: "newly-referenced.png",
          contentType: "image/png",
          lastModified: OLD,
          contentLength: 7,
        },
        {
          name: "deleted.png",
          contentType: "image/png",
          lastModified: OLD,
          contentLength: 11,
        },
        {
          name: "failed.png",
          contentType: "image/png",
          lastModified: OLD,
          contentLength: 13,
        },
        {
          name: "zero-size.png",
          contentType: "image/png",
          lastModified: OLD,
          contentLength: -1,
        },
      ],
      new Set(["failed.png"]),
    );
    const service = new BlobCleanupService(repository, storage, () => NOW);

    const result = await service.run(true);

    expect(repository.loadReferences).toHaveBeenCalledTimes(2);
    expect(storage.deleteBlob).toHaveBeenCalledTimes(3);
    // Only blobs that were actually deleted take their media rows with them.
    expect(repository.deleteAbandonedMedia).toHaveBeenCalledWith({
      deletedBlobNames: ["deleted.png", "zero-size.png"],
      olderThan: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    });
    expect(storage.deleteBlob).not.toHaveBeenCalledWith("newly-referenced.png");
    expect(result).toMatchObject({
      mode: "delete",
      scanned: 4,
      referenced: 1,
      protected: 0,
      candidateCount: 3,
      candidateBytes: 24,
      deleted: 2,
      deletedBytes: 11,
      mediaRecordsDeleted: 2,
      failed: 1,
      failedBytes: 13,
      failures: [
        {
          blobName: "failed.png",
          message: "Could not delete failed.png",
        },
      ],
    });
  });

  it("never offers a live rendition, and offers every rendition of an orphan", async () => {
    const live = "media/images/owner-1/live";
    const orphan = "media/images/owner-1/orphan";
    const emptyTable = { findMany: jest.fn(async () => []) };
    const repository = new BlobCleanupRepository({
      profile: {
        findMany: jest.fn(async () => [{ avatarBlobName: `${live}.webp` }]),
      },
      organization: emptyTable,
      organizationBlogPost: emptyTable,
      postingPhoto: emptyTable,
      organizationAuditLog: emptyTable,
    } as never);
    const inventory = [live, orphan].flatMap((base) =>
      [".webp", ".medium.webp", ".thumbnail.webp"].map((suffix) => ({
        name: `${base}${suffix}`,
        contentType: "image/webp",
        lastModified: OLD,
        contentLength: 1,
      })),
    );
    const service = new BlobCleanupService(
      repository,
      createStorage(inventory),
      () => NOW,
    );

    const result = await service.run(false);

    expect(result.referenced).toBe(3);
    expect(result.candidates.map((candidate) => candidate.blobName)).toEqual([
      `${orphan}.webp`,
      `${orphan}.medium.webp`,
      `${orphan}.thumbnail.webp`,
    ]);
  });

  it("uses a safe message for non-error deletion failures", async () => {
    const repository = {
      deleteAbandonedMedia: jest.fn(async () => 0),
      loadReferences: jest.fn(async () => ({
        blobNames: new Set<string>(),
        sourceCounts: EMPTY_SOURCE_COUNTS,
      })),
    };
    const storage = createStorage([]);
    storage.listAzureBlobs = async function* () {
      yield {
        name: "failure.png",
        contentType: "image/png",
        lastModified: OLD,
      };
    };
    storage.deleteBlob.mockRejectedValueOnce("failure");
    const service = new BlobCleanupService(repository, storage, () => NOW);

    const result = await service.run(true);

    expect(result.failures[0]?.message).toBe("Unknown deletion error.");
    expect(blobCleanupExitCode(result)).toBe(1);
  });

  it("treats old quarantined uploads as candidates whatever their declared type", async () => {
    const repository = {
      loadReferences: jest.fn(async () => ({
        blobNames: new Set<string>(),
        sourceCounts: EMPTY_SOURCE_COUNTS,
      })),
      deleteAbandonedMedia: jest.fn(async () => 1),
    };
    const storage = createStorage([
      {
        name: "quarantine/images/user-1/abandoned",
        contentType: "text/plain",
        lastModified: OLD,
        contentLength: 4,
      },
      {
        name: "quarantine/images/user-1/fresh",
        contentType: "image/png",
        lastModified: YOUNG,
      },
    ]);
    const service = new BlobCleanupService(repository, storage, () => NOW);

    const preview = await service.run(false);
    expect(preview.candidates.map((candidate) => candidate.blobName)).toEqual([
      "quarantine/images/user-1/abandoned",
    ]);
    expect(repository.deleteAbandonedMedia).not.toHaveBeenCalled();

    const result = await service.run(true);
    expect(result).toMatchObject({ deleted: 1, mediaRecordsDeleted: 1 });
  });

  it("returns a successful exit code when every candidate succeeds", () => {
    expect(blobCleanupExitCode({ failed: 0 })).toBe(0);
  });
});
