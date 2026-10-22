import { z } from "zod";
import type { Uuid } from "@/configuration/validation/uuid";
import type { AccountStatus } from "@/features/auth/auth.model";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";

export const ACCOUNT_STATUS_REASON_MIN_LENGTH = 5;
export const ACCOUNT_STATUS_REASON_MAX_LENGTH = 255;

/** Who made a status change, recorded in the audit event's metadata. */
export type AccountStatusChangeSource = "admin" | "system" | "user";

export interface AccountStatusChangeInput {
  reason: string;
  source: AccountStatusChangeSource;
  /** The admin who made the change; null or absent for the system or user. */
  actorUserId?: Uuid | null;
  context?: AuthAuditContext;
}

export interface AccountStatusChangeResult {
  userId: Uuid;
  status: AccountStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  statusChangedBy: Uuid | null;
  /** False when the account was already in the requested state. */
  changed: boolean;
}

/**
 * The body of POST /admin/users/:id/lock, /suspend and /reinstate. The reason
 * is an admin note, kept on the account and in the audit log, and never sent
 * to the user.
 */
export const accountStatusChangeBodySchema = z
  .object({
    reason: z
      .string({ error: "Reason is required." })
      .trim()
      .min(
        ACCOUNT_STATUS_REASON_MIN_LENGTH,
        `Reason must be at least ${ACCOUNT_STATUS_REASON_MIN_LENGTH} characters.`,
      )
      .max(
        ACCOUNT_STATUS_REASON_MAX_LENGTH,
        `Reason must be at most ${ACCOUNT_STATUS_REASON_MAX_LENGTH} characters.`,
      ),
  })
  .strict();

export type AccountStatusChangeBody = z.infer<
  typeof accountStatusChangeBodySchema
>;
