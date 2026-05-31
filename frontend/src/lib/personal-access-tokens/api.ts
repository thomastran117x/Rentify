import { authenticatedJson } from "@/lib/api/client";
import type {
  CreatePersonalAccessTokenResult,
  PersonalAccessTokenListResult,
  RevokePersonalAccessTokenResult,
} from "@/lib/auth/types";

export interface CreatePersonalAccessTokenInput {
  name: string;
  expiresInDays: number;
  scopes: Array<"mcp:read" | "mcp:write">;
}

export const personalAccessTokensApi = {
  list(): Promise<PersonalAccessTokenListResult> {
    return authenticatedJson<PersonalAccessTokenListResult>(
      "GET",
      "/auth/personal-access-tokens",
    );
  },
  create(
    input: CreatePersonalAccessTokenInput,
  ): Promise<CreatePersonalAccessTokenResult> {
    return authenticatedJson<
      CreatePersonalAccessTokenResult,
      CreatePersonalAccessTokenInput
    >("POST", "/auth/personal-access-tokens", input);
  },
  revoke(tokenId: string): Promise<RevokePersonalAccessTokenResult> {
    return authenticatedJson<RevokePersonalAccessTokenResult>(
      "DELETE",
      `/auth/personal-access-tokens/${encodeURIComponent(tokenId)}`,
    );
  },
};
