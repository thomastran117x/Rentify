import { z } from "zod";

export const feedbackCategorySchema = z.enum([
  "bug_report",
  "feature_request",
  "usability",
  "praise",
  "other",
]);

export const createAppFeedbackRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(160, "Name must be at most 160 characters long."),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address.")
    .transform((value) => value.toLowerCase()),
  category: feedbackCategorySchema,
  message: z
    .string()
    .trim()
    .min(10, "Message must be at least 10 characters long.")
    .max(2000, "Message must be at most 2000 characters long."),
  captchaToken: z
    .string()
    .trim()
    .min(1, "Captcha token is required.")
    .optional(),
});

export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>;
export type CreateAppFeedbackRequestBody = z.infer<
  typeof createAppFeedbackRequestSchema
>;

export interface CreateAppFeedbackInput {
  userId?: string;
  name: string;
  email: string;
  category: FeedbackCategory;
  message: string;
}

export interface AppFeedbackRecord {
  id: string;
  userId?: string;
  name: string;
  email: string;
  category: FeedbackCategory;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppFeedbackSubmissionReceipt {
  id: string;
  category: FeedbackCategory;
  createdAt: string;
}
