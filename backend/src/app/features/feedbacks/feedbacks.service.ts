import type {
  AppFeedbackSubmissionReceipt,
  CreateAppFeedbackInput,
} from "@/features/feedbacks/feedbacks.model";
import type { FeedbacksRepository } from "@/features/feedbacks/feedbacks.repository";

export class FeedbacksService {
  constructor(private readonly feedbacksRepository: FeedbacksRepository) {}

  async create(
    input: CreateAppFeedbackInput,
  ): Promise<AppFeedbackSubmissionReceipt> {
    const created = await this.feedbacksRepository.create({
      ...input,
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      message: input.message.trim(),
    });

    return {
      id: created.id,
      category: created.category,
      createdAt: created.createdAt,
    };
  }
}
