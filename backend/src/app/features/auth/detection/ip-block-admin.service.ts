import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { AdminAuditReader } from "@/features/auth/audit/auth-audit-admin.model";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type {
  AuthIpBlock,
  AuthIpBlockStore,
} from "@/features/auth/detection/ip-block.store";

export interface AuthIpBlockList {
  items: AuthIpBlock[];
}

/**
 * What an administrator can see and undo of credential-stuffing detection's
 * IP blocks. Reading the list is recorded like any other audit read, since it
 * shows client IP addresses, and fails if that record cannot be written.
 */
export class AuthIpBlockAdminService {
  constructor(
    private readonly ipBlockStore: Pick<AuthIpBlockStore, "list" | "clear">,
    private readonly authAuditService: Pick<
      AuthAuditService,
      "record" | "recordSafely"
    >,
  ) {}

  async listBlocks(reader: AdminAuditReader): Promise<AuthIpBlockList> {
    await this.authAuditService.record({
      eventType: "admin.audit_viewed",
      outcome: "success",
      userId: null,
      actorUserId: reader.userId,
      context: reader.context,
      metadata: { view: "ip_blocks" },
    });

    return { items: await this.ipBlockStore.list() };
  }

  /**
   * Lifts a block early. The audit record is best effort, like other admin
   * actions: the block is already gone when it is written.
   */
  async unblock(ipAddress: string, reader: AdminAuditReader): Promise<void> {
    const cleared = await this.ipBlockStore.clear(ipAddress);

    if (!cleared) {
      throw new ResourceNotFoundError("This IP address is not blocked.");
    }

    await this.authAuditService.recordSafely({
      eventType: "admin.ip_unblocked",
      outcome: "success",
      userId: null,
      actorUserId: reader.userId,
      context: reader.context,
      metadata: { ipAddress },
    });
  }
}
