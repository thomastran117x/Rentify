import {
  createPostingReviewRequestSchema,
  listPostingReviewsQuerySchema,
} from "@/features/postings/reviews/reviews.model";

describe("postings.reviews.model", () => {
  it("coerces review listing pagination and applies defaults", () => {
    expect(
      listPostingReviewsQuerySchema.parse({ page: "2", pageSize: "10" }),
    ).toEqual({
      page: 2,
      pageSize: 10,
    });

    expect(listPostingReviewsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
    });
  });

  it("trims review title and comment content", () => {
    expect(
      createPostingReviewRequestSchema.parse({
        rating: 5,
        title: "  Great stay  ",
        comment: "  Exactly as described.  ",
      }),
    ).toEqual({
      rating: 5,
      title: "Great stay",
      comment: "Exactly as described.",
    });
  });

  it("rejects empty trimmed review text", () => {
    const result = createPostingReviewRequestSchema.safeParse({
      rating: 5,
      title: "   ",
    });

    expect(result.success).toBe(false);
  });
});
