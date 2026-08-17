"use client";

import { Check, Loader } from "lucide-react";
import { FieldErrorMessage } from "@/components/errors";
import type { UsernameAvailability } from "@/lib/auth/use-username-availability";
import { theme } from "@/styles/theme";

interface UsernameAvailabilityHintProps {
  id: string;
  availability: UsernameAvailability;
}

/**
 * The live availability verdict under a username field.
 *
 * `aria-live="polite"` because the text changes without the user moving focus —
 * without it the verdict is invisible to a screen reader until they tab away.
 */
export function UsernameAvailabilityHint({
  id,
  availability,
}: UsernameAvailabilityHintProps) {
  const { status, message } = availability;

  if (status === "idle" || !message) {
    return null;
  }

  if (status === "taken") {
    return (
      <div aria-live="polite">
        <FieldErrorMessage id={id} message={message} tone="error" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div aria-live="polite">
        <FieldErrorMessage id={id} message={message} tone="warning" />
      </div>
    );
  }

  if (status === "checking") {
    return (
      <p
        id={id}
        aria-live="polite"
        className={`inline-flex items-center gap-2 ${theme.auth.fieldText}`}
      >
        <Loader className="h-4 w-4" aria-hidden="true" />
        <span>{message}</span>
      </p>
    );
  }

  return (
    <p
      id={id}
      aria-live="polite"
      className="inline-flex items-center gap-2 text-sm leading-6 text-emerald-700 dark:text-emerald-300"
    >
      <Check className="h-4 w-4" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
