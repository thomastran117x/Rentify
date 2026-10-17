import { environment } from "@/configuration/environment";
import { loggerFactory } from "@/configuration/logging";
import type { AuthAuditRepository } from "@/features/auth/audit/auth-audit.repository";
import { hashAuthIdentifier } from "@/features/auth/audit/auth-audit-identifier";
import type { RecordAuthAuditEventInput } from "@/features/auth/audit/auth-audit.model";

export interface AuthAuditServiceOptions {
  identifierSecret?: string;
}

/**
 * The durable record of authentication activity. Auth flows call
 * `recordSafely`, so a failed audit write is logged and never fails the
 * sign-in, unlock or sign-out that triggered it.
 */
export class AuthAuditService {
  private readonly logger = loggerFactory.forClass(AuthAuditService, "service");
  private readonly identifierSecret?: string;

  constructor(
    private readonly repository: AuthAuditRepository,
    options: AuthAuditServiceOptions = {},
  ) {
    this.identifierSecret = options.identifierSecret;
  }

  hashIdentifier(value: string): string {
    return hashAuthIdentifier(
      value,
      this.identifierSecret ??
        environment.getTokenConfig().authAuditIdentifierSecret,
    );
  }

  async record(input: RecordAuthAuditEventInput): Promise<void> {
    await this.repository.create(input);
  }

  /**
   * Logs the event, then writes it, swallowing a write failure. The log line
   * comes first so the outcome is still visible when the database is not, and
   * it carries only the fields below: never a password, code, token or the
   * raw typed identifier.
   */
  async recordSafely(input: RecordAuthAuditEventInput): Promise<void> {
    const logger = this.logger.child({ requestId: input.context?.requestId });
    const fields = {
      eventType: input.eventType,
      outcome: input.outcome,
      reasonCode: input.reasonCode,
      userId: input.userId ?? undefined,
      identifierHash: input.identifierHash,
      ipAddress: input.context?.ipAddress,
    };

    if (input.outcome === "success") {
      logger.info("Auth event.", fields);
    } else {
      logger.warn("Auth event.", fields);
    }

    try {
      await this.record(input);
    } catch (error) {
      logger.error("Failed to record auth audit event.", {
        eventType: input.eventType,
        outcome: input.outcome,
        userId: input.userId ?? undefined,
        error,
      });
    }
  }
}
