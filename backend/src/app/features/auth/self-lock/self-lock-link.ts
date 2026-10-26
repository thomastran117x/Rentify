import type { Logger } from "@/configuration/logging/types";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import { isEligibleForLocalPasswordManagement } from "@/features/auth/local-account-eligibility";
import type { SelfLockTokenStore } from "@/features/auth/self-lock/self-lock-token.store";

/**
 * A token for an alert email's "This wasn't you? Lock your account" link,
 * naming the audit event the email is about. Issued only for an account that
 * could recover from the lock by resetting its password. Best effort: a Redis
 * failure costs the link, not the alert.
 */
export async function issueSelfLockLinkToken(
  store: Pick<SelfLockTokenStore, "issue">,
  user: AuthUserRecord,
  sourceEventId: Uuid,
  logger: Logger,
): Promise<string | undefined> {
  if (!isEligibleForLocalPasswordManagement(user)) {
    return undefined;
  }

  try {
    return await store.issue({ userId: asUuid(user.id), sourceEventId });
  } catch (error) {
    logger.error("Failed to issue a self-lock token.", {
      userId: user.id,
      error,
    });
    return undefined;
  }
}
