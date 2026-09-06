"use client";

import { Info, Loader } from "lucide-react";
import { FieldErrorMessage } from "@/components/errors";
import type { EmailAvailability } from "@/lib/auth/use-email-availability";
import { theme } from "@/styles/theme";

interface EmailAvailabilityHintProps {
  id: string;
  availability: EmailAvailability;
}

/**
 * The live availability verdict under an email field.
 *
 * `aria-live="polite"` because the text changes without the user moving focus —
 * without it the verdict is invisible to a screen reader until they tab away.
 *
 * There is no success state on purpose: a free address says nothing the user
 * needs, and announcing it would make the field a readout of which addresses
 * are registered.
 */
export function EmailAvailabilityHint({
  id,
  availability,
}: EmailAvailabilityHintProps) {
  const { status, message } = availability;

  if (status === "idle" || status === "available" || !message) {
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

  // Pending verification: informational, and submitting is still the right
  // move — signup accepts the address and re-sends the code.
  return (
    <p
      id={id}
      aria-live="polite"
      className={`inline-flex items-start gap-2 ${theme.auth.fieldText}`}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
