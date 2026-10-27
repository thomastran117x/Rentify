import { environment } from "@/configuration/environment";
import { loggerFactory } from "@/configuration/logging";
import type { AuthAuditRepository } from "@/features/auth/audit/auth-audit.repository";
import { hashAuthIdentifier } from "@/features/auth/audit/auth-audit-identifier";
import type {
  AuthAuditListener,
  RecordAuthAuditEventInput,
  RecordedAuthAuditEvent,
} from "@/features/auth/audit/auth-audit.model";
import { newUuid } from "@/configuration/validation/uuid";

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
  private readonly listeners: AuthAuditListener[] = [];

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
   * Adds a listener for every event `recordSafely` writes. Suspicious-activity
   * detection subscribes once the container is built; it cannot be a
   * constructor dependency, because what it acts through records here too.
   */
  subscribe(listener: AuthAuditListener): void {
    this.listeners.push(listener);
  }

  /**
   * Logs the event, then writes it, swallowing a write failure. The log line
   * comes first so the outcome is still visible when the database is not, and
   * it carries only the fields below: never a password, code, token or the
   * raw typed identifier. Listeners hear only about events that were written,
   * since anything they flag must exist.
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

    const event: RecordedAuthAuditEvent = {
      ...input,
      id: input.id ?? newUuid(),
    };

    try {
      await this.record(event);
    } catch (error) {
      logger.error("Failed to record auth audit event.", {
        eventType: input.eventType,
        outcome: input.outcome,
        userId: input.userId ?? undefined,
        error,
      });
      return;
    }

    this.notifyListeners(event);
  }

  /**
   * Starts each listener without waiting for it. A listener that throws or
   * rejects is logged; the caller of `recordSafely` never sees it.
   */
  private notifyListeners(event: RecordedAuthAuditEvent): void {
    for (const listener of this.listeners) {
      void Promise.resolve()
        .then(() => listener(event))
        .catch((error: unknown) => {
          this.logger.error("Auth audit listener failed.", {
            eventType: event.eventType,
            eventId: event.id,
            error,
          });
        });
    }
  }
}
