import { authenticatedJson, buildPathWithQuery } from "@/lib/api/client";
import type {
  ListSecurityActivityInput,
  SecurityActivityList,
} from "@/lib/security-activity/types";

export const securityActivityApi = {
  /**
   * The signed-in user's own authentication history, newest first. The
   * session needs a recent `mfa-management` step-up.
   */
  listMine(
    input: ListSecurityActivityInput = {},
    signal?: AbortSignal,
  ): Promise<SecurityActivityList> {
    return authenticatedJson<SecurityActivityList>(
      "GET",
      buildPathWithQuery("/auth/audit/me", {
        cursor: input.cursor,
        limit: input.limit,
        category: input.category,
      }),
      undefined,
      undefined,
      signal,
    );
  },
};
