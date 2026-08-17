"use client";

import { useEffect, useState } from "react";
import { authApi } from "@/lib/auth/api";
import { hasValidUsernameFormat, normalizeUsername } from "@/lib/auth/username";

/** Matches the debounce used by the booking quote panel. */
const AVAILABILITY_DEBOUNCE_MS = 400;

export type UsernameAvailabilityStatus =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "error";

export interface UsernameAvailability {
  status: UsernameAvailabilityStatus;
  message: string | null;
}

const IDLE: UsernameAvailability = { status: "idle", message: null };
const CHECKING: UsernameAvailability = {
  status: "checking",
  message: "Checking availability...",
};

/** A verdict, tagged with the value it was fetched for. */
interface ResolvedAvailability {
  username: string;
  result: UsernameAvailability;
}

export interface UseUsernameAvailabilityOptions {
  /**
   * The username the account already holds. Typing it back is not a change, so
   * it is reported as idle rather than sending a request that would come back
   * "available" and read as if something were being claimed.
   */
  currentUsername?: string;
  /** Set false to suspend checking, e.g. while the field is locked by a cooldown. */
  enabled?: boolean;
}

/**
 * Tells the user whether a username is free before they submit.
 *
 * Debounced and abortable: every keystroke replaces the pending request, so a
 * slow response for an earlier value can never overwrite a newer verdict.
 *
 * Only the fetched verdict is state. "idle" and "checking" are derived during
 * render from the current input, which keeps the effect free of synchronous
 * setState calls and means a stale verdict can never be shown for a value it
 * was not fetched for.
 */
export function useUsernameAvailability(
  username: string,
  options: UseUsernameAvailabilityOptions = {},
): UsernameAvailability {
  const { currentUsername, enabled = true } = options;
  const [resolved, setResolved] = useState<ResolvedAvailability | null>(null);

  const normalized = normalizeUsername(username);
  // Format errors are the field validator's job, not the server's.
  const shouldCheck =
    enabled &&
    hasValidUsernameFormat(normalized) &&
    !(currentUsername && normalized === normalizeUsername(currentUsername));

  useEffect(() => {
    if (!shouldCheck) {
      return;
    }

    const abortController = new AbortController();

    const timeoutId = window.setTimeout(() => {
      authApi
        .checkUsernameAvailability(normalized, {
          signal: abortController.signal,
        })
        .then((result) => {
          if (abortController.signal.aborted) {
            return;
          }

          setResolved({
            username: normalized,
            result: result.available
              ? { status: "available", message: `${normalized} is available.` }
              : { status: "taken", message: "That username is already taken." },
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
            username: normalized,
            result: {
              status: "error",
              message: "We couldn't check that username right now.",
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

  return resolved?.username === normalized ? resolved.result : CHECKING;
}
