import {
  deleteImageBlobs,
  deleteMediaBlobs,
} from "@/features/media/media-blobs";

function createBlobService() {
  return { deleteBlob: jest.fn(async (_blobName: string) => undefined) };
}

describe("media blob deletion", () => {
  it("deletes a processed image with every rendition, and any other name alone", async () => {
    const blobService = createBlobService();

    await deleteImageBlobs(blobService, "media/images/u/m.webp");
    await deleteImageBlobs(blobService, "organizations/u/logo.png");

    expect(blobService.deleteBlob.mock.calls.map(([name]) => name)).toEqual([
      "media/images/u/m.webp",
      "media/images/u/m.medium.webp",
      "media/images/u/m.thumbnail.webp",
      "organizations/u/logo.png",
    ]);
  });

  it("deletes an item's upload, then its image once it was processed", async () => {
    const blobService = createBlobService();

    await deleteMediaBlobs(blobService, {
      originalBlobName: "quarantine/images/u/waiting",
      processedBlobName: null,
    });
    await deleteMediaBlobs(blobService, {
      originalBlobName: "quarantine/images/u/m",
      processedBlobName: "media/images/u/m.webp",
    });

    expect(blobService.deleteBlob.mock.calls.map(([name]) => name)).toEqual([
      "quarantine/images/u/waiting",
      "quarantine/images/u/m",
      "media/images/u/m.webp",
      "media/images/u/m.medium.webp",
      "media/images/u/m.thumbnail.webp",
    ]);
  });
});
