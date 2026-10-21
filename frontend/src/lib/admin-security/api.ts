import { authenticatedJson, buildPathWithQuery } from "@/lib/api/client";
import type {
  AdminAuthAuditEventList,
  AdminUserSecuritySummary,
  ListAdminAuthAuditInput,
} from "@/lib/admin-security/types";

export const adminSecurityApi = {
  /**
   * Searches every account's auth audit events, newest first. Admin only;
   * the backend records each call as an `admin.audit_viewed` event.
   */
  listEvents(
    input: ListAdminAuthAuditInput = {},
    signal?: AbortSignal,
  ): Promise<AdminAuthAuditEventList> {
    return authenticatedJson<AdminAuthAuditEventList>(
      "GET",
      buildPathWithQuery("/admin/auth/audit", {
        user: input.user,
        ip: input.ip,
        // Repeated as `eventType=a&eventType=b`.
        eventType: input.eventType,
        outcome: input.outcome,
        from: input.from,
        to: input.to,
        cursor: input.cursor,
        limit: input.limit,
      }),
      undefined,
      undefined,
      signal,
    );
  },

  /** One account's sign-in security summary, including its live lockout. */
  getUserSummary(
    userId: string,
    signal?: AbortSignal,
  ): Promise<AdminUserSecuritySummary> {
    return authenticatedJson<AdminUserSecuritySummary>(
      "GET",
      `/admin/users/${encodeURIComponent(userId)}/security`,
      undefined,
      undefined,
      signal,
    );
  },
};
