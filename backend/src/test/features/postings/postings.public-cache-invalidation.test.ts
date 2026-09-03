import { invalidatePublicPostingProjection } from "@/features/postings/postings.public-cache-invalidation";
import { testUuid } from "../../support/uuid";

const POSTING_1_ID = testUuid(9000, 254272);

describe("invalidatePublicPostingProjection", () => {
  it("does nothing when the posting id is missing", async () => {
    const invalidatePublic = jest.fn();

    await invalidatePublicPostingProjection({ invalidatePublic }, undefined);

    expect(invalidatePublic).not.toHaveBeenCalled();
  });

  it("delegates invalidation to the public cache service when an id is present", async () => {
    const invalidatePublic = jest.fn(async () => 1);

    await invalidatePublicPostingProjection({ invalidatePublic }, POSTING_1_ID);

    expect(invalidatePublic).toHaveBeenCalledWith(POSTING_1_ID);
  });
});
