import { FeedbacksRepository } from "@/features/feedbacks/feedbacks.repository";

describe("FeedbacksRepository", () => {
  it("persists feedback and maps nullable user ids", async () => {
    const create = jest.fn(async () => ({
      id: "feedback-1",
      userId: null,
      name: "Taylor Morgan",
      email: "taylor@example.com",
      category: "feature_request",
      message: "Please add saved searches to the renter flow.",
      createdAt: new Date("2026-06-15T12:00:00.000Z"),
      updatedAt: new Date("2026-06-15T12:00:00.000Z"),
    }));
    const repository = new FeedbacksRepository({
      feedback: {
        create,
      },
    } as any);

    const result = await repository.create({
      name: "Taylor Morgan",
      email: "taylor@example.com",
      category: "feature_request",
      message: "Please add saved searches to the renter flow.",
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        userId: null,
        name: "Taylor Morgan",
        email: "taylor@example.com",
        category: "feature_request",
        message: "Please add saved searches to the renter flow.",
      }),
    });
    expect(result).toEqual({
      id: "feedback-1",
      userId: undefined,
      name: "Taylor Morgan",
      email: "taylor@example.com",
      category: "feature_request",
      message: "Please add saved searches to the renter flow.",
      createdAt: "2026-06-15T12:00:00.000Z",
      updatedAt: "2026-06-15T12:00:00.000Z",
    });
  });
});
