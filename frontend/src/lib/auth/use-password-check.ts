"use client";

import { useEffect, useState } from "react";
import { authApi } from "@/lib/auth/api";
import {
  type PasswordPersonalContext,
  getPasswordStrengthError,
} from "@/lib/auth/password";
import type { PasswordIssue } from "@/lib/auth/types";

/** Matches the username availability check. */
const PASSWORD_CHECK_DEBOUNCE_MS = 400;

export type PasswordCheckStatus = "idle" | "checking" | "checked" | "error";

export interface PasswordCheck {
  status: PasswordCheckStatus;
  /** Server reasons the password would be refused: common, breached and so on. */
  issues: PasswordIssue[];
  /** Advice that does not block it, such as a breach in `warn` mode. */
  warnings: PasswordIssue[];
}

const IDLE: PasswordCheck = { status: "idle", issues: [], warnings: [] };
const CHECKING: PasswordCheck = {
  status: "checking",
  issues: [],
  warnings: [],
};
const FAILED: PasswordCheck = { status: "error", issues: [], warnings: [] };

interface ResolvedCheck {
  key: string;
  result: PasswordCheck;
}

function trimmed(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

/**
 * Asks the server what it thinks of a new password while the user types, so
 * the common and breached checks, which only it can make, show up before
 * submitting rather than as a rejected form.
 *
 * Mirrors `use-username-availability`: debounced, abortable per keystroke, and
 * only the fetched verdict is state, tagged with the input it was fetched for,
 * so a slow response can never be shown for a newer value. Nothing is sent
 * until the local rules pass, and a failed check never blocks the form: the
 * server checks again on submit.
 */
export function usePasswordCheck(
  password: string,
  context: PasswordPersonalContext = {},
  options: { enabled?: boolean } = {},
): PasswordCheck {
  const { enabled = true } = options;
  const [resolved, setResolved] = useState<ResolvedCheck | null>(null);

  const username = trimmed(context.username);
  const email = trimmed(context.email);
  const firstName = trimmed(context.firstName);
  const lastName = trimmed(context.lastName);
  const key = JSON.stringify([password, username, email, firstName, lastName]);
  const shouldCheck =
    enabled &&
    password.length > 0 &&
    getPasswordStrengthError(password, context) === null;

  useEffect(() => {
    if (!shouldCheck) {
      return;
    }

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      authApi
        .checkPassword(
          { password, username, email, firstName, lastName },
          { signal: abortController.signal },
        )
        .then((result) => {
          if (abortController.signal.aborted) {
            return;
          }

          setResolved({
            key,
            result: {
              status: "checked",
              issues: result.issues ?? [],
              warnings: result.warnings ?? [],
            },
          });
        })
        .catch((error: unknown) => {
          if (
            abortController.signal.aborted ||
            (error as { name?: unknown } | null)?.name === "AbortError"
          ) {
            return;
          }

          setResolved({ key, result: FAILED });
        });
    }, PASSWORD_CHECK_DEBOUNCE_MS);

    return () => {
      abortController.abort();
      window.clearTimeout(timeoutId);
    };
  }, [key, shouldCheck, password, username, email, firstName, lastName]);

  if (!shouldCheck) {
    return IDLE;
  }

  return resolved?.key === key ? resolved.result : CHECKING;
}

/** The server's blocking reasons for the current password, as one message. */
export function getPasswordCheckError(check: PasswordCheck): string | null {
  return check.status === "checked" && check.issues.length > 0
    ? check.issues.map((issue) => issue.message).join(" ")
    : null;
}
