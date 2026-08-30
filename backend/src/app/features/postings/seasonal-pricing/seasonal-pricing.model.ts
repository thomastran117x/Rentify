import { z } from "zod";
import type { Uuid } from "@/configuration/validation/uuid";

export const upsertSeasonalPricingSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
    dailyAmount: z.number().positive(),
  })
  .refine((d) => d.startDate <= d.endDate, {
    message: "startDate must be on or before endDate",
    path: ["startDate"],
  });

export type UpsertSeasonalPricingBody = z.infer<
  typeof upsertSeasonalPricingSchema
>;

export interface SeasonalPricingRecord {
  id: Uuid;
  postingId: Uuid;
  name: string;
  startDate: string;
  endDate: string;
  dailyAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSeasonalPricingInput {
  postingId: Uuid;
  name: string;
  startDate: string;
  endDate: string;
  dailyAmount: number;
}
