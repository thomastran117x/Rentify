import { FeedbacksService } from "@/features/feedbacks/feedbacks.service";

describe("FeedbacksService", () => {
  it("normalizes feedback input and returns a submission receipt", async () => {
    const create = jest.fn(
      async (input: {
        userId?: string;
        name: string;
        email: string;
        category: string;
        message: string;
      }) => ({
        id: "feedback-1",
        ...input,
        createdAt: "2026-06-15T12:00:00.000Z",
        updatedAt: "2026-06-15T12:00:00.000Z",
      }),
    );
    const service = new FeedbacksService({
      create,
    } as any);

    const result = await service.create({
      userId: "user-1",
      name: "  Taylor Morgan  ",
      email: "TAYLOR@Example.com  ",
      category: "feature_request",
      message: "  Please add saved searches to the renter flow.  ",
    });

    expect(create).toHaveBeenCalledWith({
      userId: "user-1",
      name: "Taylor Morgan",
      email: "taylor@example.com",
      category: "feature_request",
      message: "Please add saved searches to the renter flow.",
    });
    expect(result).toEqual({
      id: "feedback-1",
      category: "feature_request",
      createdAt: "2026-06-15T12:00:00.000Z",
    });
  });
});
