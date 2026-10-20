import type { AuthAuditRepository } from "@/features/auth/audit/auth-audit.repository";
import {
  AUDIT_DEVICE_ID_LENGTH,
  decodeActivityCursor,
  encodeActivityCursor,
  invalidCursorError,
  toSecurityActivityItem,
} from "@/features/auth/audit/auth-audit-activity";
import {
  SECURITY_ACTIVITY_CATEGORY_EVENT_TYPES,
  type ListSecurityActivityInput,
  type SecurityActivityList,
} from "@/features/auth/audit/auth-audit.model";
import type { DeviceRepository } from "@/features/auth/device/device.repository";

/**
 * Reads a user's own authentication history for the account page. Writing
 * stays with `AuthAuditService`; this side only ever queries by the caller's
 * own user id, so events with no user (unknown-username attempts) and other
 * users' events are unreachable.
 */
export class AuthAuditActivityService {
  constructor(
    private readonly repository: AuthAuditRepository,
    private readonly deviceRepository: DeviceRepository,
  ) {}

  async listForUser(
    input: ListSecurityActivityInput,
  ): Promise<SecurityActivityList> {
    const afterId = input.cursor
      ? decodeActivityCursor(input.cursor)
      : undefined;
    const [rows, devices] = await Promise.all([
      this.repository.listForUser({
        userId: input.userId,
        eventTypes: input.category
          ? SECURITY_ACTIVITY_CATEGORY_EVENT_TYPES[input.category]
          : undefined,
        outcome: input.outcome,
        afterId,
        createdFrom: input.from ? new Date(input.from) : undefined,
        createdBefore: input.to ? new Date(input.to) : undefined,
        limit: input.limit + 1,
      }),
      this.deviceRepository.listKnownDevices(input.userId),
    ]);

    if (!rows) {
      throw invalidCursorError();
    }

    const page = rows.slice(0, input.limit);
    const knownDeviceIds = new Set(
      devices.map((device) => device.deviceId.slice(0, AUDIT_DEVICE_ID_LENGTH)),
    );
    const last = page.at(-1);

    return {
      items: page.map((row) =>
        toSecurityActivityItem(row, {
          currentSessionId: input.sessionId,
          knownDeviceIds,
        }),
      ),
      nextCursor:
        rows.length > input.limit && last
          ? encodeActivityCursor(last.id)
          : null,
    };
  }
}
