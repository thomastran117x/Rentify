import { SEED_POSTINGS } from "@/seeds/fixtures/postings";

describe("seeded posting photo fixtures", () => {
  it("pre-populates thumbnail metadata for every seeded posting photo", () => {
    for (const posting of SEED_POSTINGS) {
      expect(posting.photos.length).toBeGreaterThan(0);

      for (const photo of posting.photos) {
        expect(photo.thumbnailBlobName).toBeDefined();
        expect(photo.thumbnailBlobUrl).toBeDefined();
      }
    }
  });

  it("matches the target posting distribution", () => {
    const publishedAvailable = SEED_POSTINGS.filter(
      (posting) =>
        posting.status === "published" &&
        (posting.availabilityStatus === "available" ||
          posting.availabilityStatus === "limited"),
    ).length;
    const draft = SEED_POSTINGS.filter(
      (posting) => posting.status === "draft",
    ).length;
    const paused = SEED_POSTINGS.filter(
      (posting) => posting.status === "paused",
    ).length;

    expect(SEED_POSTINGS).toHaveLength(280);
    expect(publishedAvailable).toBe(200);
    expect(draft).toBe(40);
    expect(paused).toBe(40);
  });
});
