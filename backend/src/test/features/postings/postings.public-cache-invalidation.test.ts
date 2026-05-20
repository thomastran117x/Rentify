import { invalidatePublicPostingProjection } from "@/features/postings/postings.public-cache-invalidation";

describe("invalidatePublicPostingProjection", () => {
  it("does nothing when the posting id is missing", async () => {
    const invalidatePublic = jest.fn();

    await invalidatePublicPostingProjection({ invalidatePublic }, undefined);

    expect(invalidatePublic).not.toHaveBeenCalled();
  });

  it("delegates invalidation to the public cache service when an id is present", async () => {
    const invalidatePublic = jest.fn(async () => 1);

    await invalidatePublicPostingProjection({ invalidatePublic }, "posting-1");

    expect(invalidatePublic).toHaveBeenCalledWith("posting-1");
  });
});
