"use client";

import { useEffect, useState } from "react";
import { authApi } from "@/lib/auth/api";
import { hasValidEmailFormat, normalizeEmail } from "@/lib/auth/email";

/** Matches the debounce used by the username availability check. */
const AVAILABILITY_DEBOUNCE_MS = 400;

export type EmailAvailabilityStatus =
  | "idle"
  | "checking"
  | "available"
  | "pending"
  | "taken"
  | "error";

export interface EmailAvailability {
  status: EmailAvailabilityStatus;
  message: string | null;
}

const IDLE: EmailAvailability = { status: "idle", message: null };
const CHECKING: EmailAvailability = {
  status: "checking",
  message: "Checking availability...",
};

/** A verdict, tagged with the value it was fetched for. */
interface ResolvedAvailability {
  email: string;
  result: EmailAvailability;
}

export interface UseEmailAvailabilityOptions {
  /**
   * The address the account already holds. Typing it back is not a change, so
   * it is reported as idle rather than sending a request that would come back
   * "available" and read as if something were being claimed.
   */
  currentEmail?: string;
  /** Set false to suspend checking, e.g. while the field is locked. */
  enabled?: boolean;
}

/**
 * Tells the user whether an email is free before they submit.
 *
 * Debounced and abortable: every keystroke replaces the pending request, so a
 * slow response for an earlier value can never overwrite a newer verdict.
 *
 * Only the fetched verdict is state. "idle" and "checking" are derived during
 * render from the current input, which keeps the effect free of synchronous
 * setState calls and means a stale verdict can never be shown for a value it
 * was not fetched for.
 *
 * Note `pending` is not a failure. An address whose signup is unverified is
 * still accepted by the backend, so the form stays submittable and the message
 * only explains what the person is about to run into.
 */
export function useEmailAvailability(
  email: string,
  options: UseEmailAvailabilityOptions = {},
): EmailAvailability {
  const { currentEmail, enabled = true } = options;
  const [resolved, setResolved] = useState<ResolvedAvailability | null>(null);

  const normalized = normalizeEmail(email);
  // Format errors are the field validator's job, not the server's.
  const shouldCheck =
    enabled &&
    hasValidEmailFormat(normalized) &&
    !(currentEmail && normalized === normalizeEmail(currentEmail));

  useEffect(() => {
    if (!shouldCheck) {
      return;
    }

    const abortController = new AbortController();

    const timeoutId = window.setTimeout(() => {
      authApi
        .checkEmailAvailability(normalized, {
          signal: abortController.signal,
        })
        .then((result) => {
          if (abortController.signal.aborted) {
            return;
          }

          setResolved({
            email: normalized,
            result: toAvailability(result.available, result.reason),
          });
        })
        .catch((error: unknown) => {
          if (
            abortController.signal.aborted ||
            (error instanceof Error && error.name === "AbortError")
          ) {
            return;
          }

          // A failed check must not block the form: the backend still enforces
          // uniqueness on submit.
          setResolved({
            email: normalized,
            result: {
              status: "error",
              message: "We couldn't check that email right now.",
            },
          });
        });
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => {
      abortController.abort();
      window.clearTimeout(timeoutId);
    };
  }, [normalized, shouldCheck]);

  if (!shouldCheck) {
    return IDLE;
  }

  return resolved?.email === normalized ? resolved.result : CHECKING;
}

function toAvailability(
  available: boolean,
  reason: "taken" | "pending-verification" | null,
): EmailAvailability {
  if (!available) {
    return {
      status: "taken",
      message: "This email is already in use.",
    };
  }

  if (reason === "pending-verification") {
    return {
      status: "pending",
      message:
        "You already started signing up with this email. Check your inbox for the code, or continue to get a new one.",
    };
  }

  // Deliberately silent. A free address is the overwhelmingly common case, and
  // a green "that email is available" would announce, to anyone who cared to
  // try, exactly which addresses are registered. The user learns what they need
  // to from the cases that are not free.
  return { status: "available", message: null };
}
