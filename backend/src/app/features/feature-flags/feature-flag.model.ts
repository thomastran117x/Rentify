import { z } from "zod";

export type FeatureFlagSource = "db" | "env" | "default";

export interface ResolvedFeatureFlag {
  name: string;
  enabled: boolean;
  source: FeatureFlagSource;
  description?: string | null;
}

export interface FeatureFlagRecord {
  id: number;
  name: string;
  enabled: boolean;
  description: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAuditLogInput {
  flagName: string;
  action: "created" | "updated" | "deleted";
  oldEnabled?: boolean | null;
  newEnabled?: boolean | null;
  oldDescription?: string | null;
  newDescription?: string | null;
  actorUserId?: string | null;
}

export const featureFlagNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_\-.]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/,
    "Flag name must contain only letters, numbers, hyphens, underscores, and dots.",
  );

export const setFlagBodySchema = z.object({
  enabled: z.boolean(),
  description: z.string().max(1000).optional().nullable(),
});

export type SetFlagBody = z.infer<typeof setFlagBodySchema>;

export interface SetFlagInput {
  name: string;
  enabled: boolean;
  description?: string | null;
  actorUserId?: string;
}

export interface DeleteFlagInput {
  name: string;
  actorUserId?: string;
}

export interface DeleteFlagResult {
  name: string;
  deletedOverride: boolean;
  effectiveEnabled: boolean;
  effectiveSource: FeatureFlagSource;
}
