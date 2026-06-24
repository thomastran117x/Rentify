import { authenticatedJson } from "@/lib/api/client";
import { normalizeFeatureName } from "@/lib/features";

export type FeatureFlagSource = "db" | "env" | "default";

export interface ResolvedFeatureFlag {
  name: string;
  enabled: boolean;
  source: FeatureFlagSource;
  description?: string | null;
}

export interface SetFeatureFlagBody {
  enabled: boolean;
  description?: string | null;
}

export interface DeleteFeatureFlagResult {
  name: string;
  deletedOverride: boolean;
  effectiveEnabled: boolean;
  effectiveSource: FeatureFlagSource;
}

export const adminFeatureFlagsApi = {
  list(): Promise<ResolvedFeatureFlag[]> {
    return authenticatedJson<ResolvedFeatureFlag[]>(
      "GET",
      "/admin/feature-flags",
    );
  },

  set(name: string, body: SetFeatureFlagBody): Promise<ResolvedFeatureFlag> {
    return authenticatedJson<ResolvedFeatureFlag, SetFeatureFlagBody>(
      "PUT",
      `/admin/feature-flags/${encodeURIComponent(normalizeFeatureName(name))}`,
      body,
    );
  },

  delete(name: string): Promise<DeleteFeatureFlagResult> {
    return authenticatedJson<DeleteFeatureFlagResult>(
      "DELETE",
      `/admin/feature-flags/${encodeURIComponent(normalizeFeatureName(name))}`,
    );
  },
};
