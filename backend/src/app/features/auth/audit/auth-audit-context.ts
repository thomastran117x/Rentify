import type { Request } from "express";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";

/**
 * Reads the audit context from what the request middleware already resolved:
 * the client IP from client-context (which honours the `http.trustedProxy*`
 * settings), its user agent and device, and the request id. Headers are
 * deliberately not re-parsed here, so the recorded IP is always the one the
 * rest of the request saw — the proxy's own address when proxy headers are not
 * trusted.
 *
 * `deviceId` overrides the fingerprinted device, matching `resolveDeviceId`.
 */
export function toAuthAuditContext(
  request: Request,
  deviceId?: string,
): AuthAuditContext {
  return {
    ipAddress: request.client?.ip,
    userAgent: request.client?.device.userAgent,
    deviceId: deviceId ?? request.client?.device.id,
    requestId: request.requestId,
  };
}
