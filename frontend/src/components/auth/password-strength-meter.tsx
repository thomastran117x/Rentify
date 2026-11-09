"use client";

import { AlertTriangle, Loader2, XCircle } from "lucide-react";
import {
  type PasswordPersonalContext,
  getPasswordStrengthError,
  passwordLength,
} from "@/lib/auth/password";
import type { PasswordCheck } from "@/lib/auth/use-password-check";

export interface PasswordStrength {
  /** 0 is refused; 1 to 4 are acceptable, from fair to very strong. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

const LABELS = ["Too weak", "Fair", "Good", "Strong", "Very strong"] as const;

/**
 * A rough guide, not a guarantee: length counts most, then a mix of kinds of
 * character. It never calls a password the server would refuse anything but
 * "Too weak", and a breach warning caps it at "Fair".
 */
export function estimatePasswordStrength(
  password: string,
  context: PasswordPersonalContext,
  check: PasswordCheck,
): PasswordStrength | null {
  if (!password) {
    return null;
  }

  if (getPasswordStrengthError(password, context) || check.issues.length > 0) {
    return { score: 0, label: LABELS[0] };
  }

  const length = passwordLength(password);
  const kinds = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}]/u].filter(
    (pattern) => pattern.test(password),
  ).length;
  const score = Math.min(
    4,
    1 + Number(length >= 16) + Number(length >= 20) + Number(kinds >= 3),
  ) as PasswordStrength["score"];
  const capped = check.warnings.length > 0 ? 1 : score;

  return { score: capped, label: LABELS[capped] };
}

const BAR_TONES: Record<PasswordStrength["score"], string> = {
  0: "bg-rose-500",
  1: "bg-amber-500",
  2: "bg-lime-500",
  3: "bg-emerald-500",
  4: "bg-emerald-600",
};

interface PasswordStrengthMeterProps {
  id: string;
  password: string;
  context?: PasswordPersonalContext;
  check: PasswordCheck;
  /** Set when the field's own error already shows the server's reasons. */
  hideIssues?: boolean;
}

/**
 * The strength bar under a new-password field, with what the server said:
 * reasons it would refuse the password, and warnings that do not block it.
 * The label is a polite live region, so a screen reader hears the verdict
 * settle rather than every keystroke's intermediate state.
 */
export function PasswordStrengthMeter({
  id,
  password,
  context = {},
  check,
  hideIssues = false,
}: PasswordStrengthMeterProps) {
  const strength = estimatePasswordStrength(password, context, check);

  if (!strength) {
    return null;
  }

  return (
    <div id={id} className="space-y-1.5" data-score={strength.score}>
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${
              strength.score >= step || (strength.score === 0 && step === 1)
                ? BAR_TONES[strength.score]
                : "bg-slate-200 dark:bg-slate-700"
            }`}
          />
        ))}
      </div>
      <p
        className="text-xs font-medium text-slate-600 dark:text-slate-300"
        aria-live="polite"
      >
        Strength: {strength.label}
      </p>
      {check.status === "checking" ? (
        <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Checking against common and breached passwords…
        </p>
      ) : null}
      {(hideIssues ? [] : check.issues).map((issue) => (
        <p
          key={`issue-${issue.code}`}
          data-issue={issue.code}
          className="flex items-start gap-1.5 text-sm text-rose-700 dark:text-rose-300"
        >
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {issue.message}
        </p>
      ))}
      {check.warnings.map((warning) => (
        <p
          key={`warning-${warning.code}`}
          data-warning={warning.code}
          className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          {warning.message}
        </p>
      ))}
    </div>
  );
}
