import { authenticatedJson, buildPathWithQuery } from "@/lib/api/client";
import type {
  AccountStatusAction,
  AdminAccountStatusChangeResult,
  AdminAuthAuditEventList,
  AdminUserSecuritySummary,
  AuthIpBlockList,
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
        flagged: input.flagged ? "true" : undefined,
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

  /**
   * Locks, suspends or reinstates an account. Admin only, and never the
   * caller's own account. The reason is an admin note the user never sees.
   */
  changeAccountStatus(
    userId: string,
    action: AccountStatusAction,
    reason: string,
  ): Promise<AdminAccountStatusChangeResult> {
    return authenticatedJson<
      AdminAccountStatusChangeResult,
      { reason: string }
    >("POST", `/admin/users/${encodeURIComponent(userId)}/${action}`, {
      reason,
    });
  },

  /**
   * The addresses suspicious-activity detection has blocked from sign-in.
   * Admin only; the backend records each call as an `admin.audit_viewed`.
   */
  listIpBlocks(signal?: AbortSignal): Promise<AuthIpBlockList> {
    return authenticatedJson<AuthIpBlockList>(
      "GET",
      "/admin/auth/ip-blocks",
      undefined,
      undefined,
      signal,
    );
  },

  /** Lifts an IP block before it expires. A 404 means it already lifted. */
  unblockIp(ipAddress: string): Promise<void> {
    return authenticatedJson<void>(
      "DELETE",
      `/admin/auth/ip-blocks/${encodeURIComponent(ipAddress)}`,
    );
  },
};
