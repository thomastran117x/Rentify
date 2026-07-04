import { z } from "zod";

export const savedSearchParamsSchema = z.object({
  family: z.enum(["place", "equipment", "vehicle"]).optional(),
  subtype: z.string().max(50).optional(),
  city: z.string().max(120).optional(),
  minDailyPrice: z.number().nonnegative().optional(),
  maxDailyPrice: z.number().nonnegative().optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  availabilityStatus: z
    .enum(["available", "limited", "unavailable"])
    .optional(),
  instantBooking: z.boolean().optional(),
  cancellationPolicy: z.enum(["flexible", "moderate", "strict"]).optional(),
});

export type SavedSearchParams = z.infer<typeof savedSearchParamsSchema>;

export const createSavedSearchRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  searchParams: savedSearchParamsSchema,
  alertEnabled: z.boolean().default(true),
});

export type CreateSavedSearchRequestBody = z.infer<
  typeof createSavedSearchRequestSchema
>;

export const updateSavedSearchRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    searchParams: savedSearchParamsSchema.optional(),
    alertEnabled: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.searchParams !== undefined ||
      data.alertEnabled !== undefined,
    { message: "At least one field must be provided." },
  );

export type UpdateSavedSearchRequestBody = z.infer<
  typeof updateSavedSearchRequestSchema
>;

export const MAX_SAVED_SEARCHES_PER_USER = 10;

export interface SavedSearchRecord {
  id: string;
  userId: string;
  name: string;
  searchParams: SavedSearchParams;
  alertEnabled: boolean;
  lastAlertSentAt?: string;
  createdAt: string;
  updatedAt: string;
}
