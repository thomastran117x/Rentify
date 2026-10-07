import BadRequestError from "@/errors/http/bad-request.error";
import { guardImageAttachments } from "@/features/media/media-attachment-guard";
import { createMediaGuardTransaction } from "../../support/media-attachment-guard";

const NOW = new Date("2026-10-07T12:00:00.000Z");

function sqlValues(
  transaction: ReturnType<typeof createMediaGuardTransaction>,
) {
  const [query] = transaction.$queryRaw.mock.calls[0] as unknown as [
    { values: unknown[]; sql: string },
  ];

  return query;
}

describe("guardImageAttachments", () => {
  it("does nothing when the write stores and releases no image", async () => {
    const transaction = createMediaGuardTransaction();

    await guardImageAttachments(
      transaction as never,
      { attached: [null, undefined, "  "], released: [] },
      NOW,
    );

    expect(transaction.$queryRaw).not.toHaveBeenCalled();
    expect(transaction.media.updateMany).not.toHaveBeenCalled();
  });

  it("locks the rows behind every stored and released name and moves the ready ones", async () => {
    const transaction = createMediaGuardTransaction([
      { name: "media/images/u/kept.webp", status: "ready" },
      { name: "media/images/u/released.webp", status: "ready" },
    ]);

    await guardImageAttachments(
      transaction as never,
      {
        attached: [" media/images/u/kept.webp ", "legacy/photo.jpg"],
        released: ["media/images/u/released.webp", "media/images/u/kept.webp"],
      },
      NOW,
    );

    const query = sqlValues(transaction);
    expect(query.sql).toContain("FOR UPDATE");
    expect(query.values).toEqual([
      "media/images/u/kept.webp",
      "legacy/photo.jpg",
      "media/images/u/released.webp",
    ]);
    expect(transaction.media.updateMany).toHaveBeenCalledWith({
      where: {
        processedBlobName: {
          in: ["media/images/u/kept.webp", "media/images/u/released.webp"],
        },
        status: "ready",
      },
      data: { updatedAt: NOW },
    });
  });

  it("refuses to store an image the media cleanup has claimed", async () => {
    const transaction = createMediaGuardTransaction([
      { name: "media/images/u/gone.webp", status: "rejected" },
    ]);

    const result = guardImageAttachments(transaction as never, {
      attached: ["media/images/u/gone.webp"],
    });

    await expect(result).rejects.toBeInstanceOf(BadRequestError);
    await expect(result).rejects.toThrow(
      "Image is no longer available. Upload it again.",
    );
    expect(transaction.media.updateMany).not.toHaveBeenCalled();
  });

  it("lets a write release an image the media cleanup has claimed", async () => {
    const transaction = createMediaGuardTransaction([
      { name: "media/images/u/gone.webp", status: "rejected" },
    ]);

    await guardImageAttachments(transaction as never, {
      attached: [],
      released: ["media/images/u/gone.webp"],
    });

    expect(transaction.media.updateMany).not.toHaveBeenCalled();
  });
});
