import { authenticatedJson, buildPathWithQuery, publicJson } from "@/lib/api/client";
import type { Pagination } from "@/lib/api/types";

export interface PublicProfileRecord {
  id: string;
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  username: string;
  phoneNumber?: string;
  avatarUrl?: string;
  trustworthinessScore: number;
  rentPostingsCount: number;
  availableRentPostingsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileRecord extends PublicProfileRecord {
  avatarBlobName?: string;
  isPrivate: boolean;
  recommendationPersonalizationEnabled: boolean;
}

export interface ListProfilesResult {
  profiles: PublicProfileRecord[];
  pagination: Pagination;
  query?: string;
}

export interface ListProfilesFilters {
  page?: number;
  pageSize?: number;
  q?: string;
}

export interface UpdateOwnProfileInput {
  username: string;
  phoneNumber?: string | null;
  isPrivate?: boolean;
  recommendationPersonalizationEnabled?: boolean;
  avatarUrl?: string | null;
  avatarBlobName?: string | null;
  trustworthinessScore?: number;
  rentPostingsCount?: number;
  availableRentPostingsCount?: number;
}

export const profilesApi = {
  list(input: ListProfilesFilters = {}): Promise<ListProfilesResult> {
    return publicJson<ListProfilesResult>(
      "GET",
      buildPathWithQuery("/profiles", {
        page: input.page ?? 1,
        pageSize: input.pageSize ?? 20,
        q: input.q,
      }),
    );
  },
  getMine(): Promise<ProfileRecord> {
    return authenticatedJson<ProfileRecord>("GET", "/profile/me");
  },
  updateMine(input: UpdateOwnProfileInput): Promise<ProfileRecord> {
    return authenticatedJson<ProfileRecord, UpdateOwnProfileInput>(
      "PUT",
      "/profile/me",
      input,
    );
  },
};
