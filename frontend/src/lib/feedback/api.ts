import { optionalAuthJson } from "@/lib/api/client";

export type FeedbackCategory =
  | "bug_report"
  | "feature_request"
  | "usability"
  | "praise"
  | "other";

export interface CreateAppFeedbackRequest {
  name: string;
  email: string;
  category: FeedbackCategory;
  message: string;
  captchaToken?: string;
}

export interface AppFeedbackSubmissionReceipt {
  id: string;
  category: FeedbackCategory;
  createdAt: string;
}

export const feedbackApi = {
  create(
    input: CreateAppFeedbackRequest,
  ): Promise<AppFeedbackSubmissionReceipt> {
    return optionalAuthJson<
      AppFeedbackSubmissionReceipt,
      CreateAppFeedbackRequest
    >("POST", "/feedback", input);
  },
};
