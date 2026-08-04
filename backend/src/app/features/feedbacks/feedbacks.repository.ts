import { randomUUID } from "node:crypto";
import type { Feedback } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  AppFeedbackRecord,
  CreateAppFeedbackInput,
} from "@/features/feedbacks/feedbacks.model";

export class FeedbacksRepository extends BaseRepository {
  async create(input: CreateAppFeedbackInput): Promise<AppFeedbackRecord> {
    const created = await this.executeAsync(() =>
      this.prisma.feedback.create({
        data: {
          id: randomUUID(),
          userId: input.userId ?? null,
          name: input.name,
          email: input.email,
          category: input.category,
          message: input.message,
        },
      }),
    );

    return this.mapFeedback(created);
  }

  private mapFeedback(feedback: Feedback): AppFeedbackRecord {
    return {
      id: feedback.id,
      userId: feedback.userId ?? undefined,
      name: feedback.name,
      email: feedback.email,
      category: feedback.category,
      message: feedback.message,
      createdAt: feedback.createdAt.toISOString(),
      updatedAt: feedback.updatedAt.toISOString(),
    };
  }
}
