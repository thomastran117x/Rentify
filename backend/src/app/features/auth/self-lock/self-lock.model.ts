import { z } from "zod";
import type { Uuid } from "@/configuration/validation/uuid";

/** A lock link lasts a day: long enough to read the email, short enough to rot. */
export const SELF_LOCK_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export const SELF_LOCK_TOKEN_MAX_LENGTH = 256;

export const SELF_LOCK_REASON = "Reported by user";

export const SELF_LOCK_LINK_EXPIRED_MESSAGE =
  "This link has expired or was already used.";

/** How the user reached the lock, recorded on the `account.locked` event. */
export type SelfLockChannel = "email_link" | "session";

/** What a lock token stands for. */
export interface SelfLockTokenPayload {
  userId: Uuid;
  /** The audit event whose email carried the link. */
  sourceEventId: Uuid;
}

/** The same for every accepted request, so it says nothing about the account. */
export interface SelfLockResult {
  locked: true;
}

export const selfLockRequestSchema = z
  .object({
    token: z
      .string({ error: "Token is required." })
      .trim()
      .min(1, "Token is required.")
      .max(SELF_LOCK_TOKEN_MAX_LENGTH, "Token is invalid."),
  })
  .strict();

export type SelfLockRequest = z.infer<typeof selfLockRequestSchema>;
