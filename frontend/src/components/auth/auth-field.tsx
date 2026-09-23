import type { ReactNode } from "react";
import { FieldErrorMessage } from "@/components/errors";
import { theme } from "@/styles/theme";

interface AuthFieldProps {
  id: string;
  label: string;
  error?: string;
  errorId?: string;
  /**
   * Drives the "filled" ring. The forms track this themselves because a value
   * that is only whitespace should not count as filled.
   */
  hasValue: boolean;
  icon: ReactNode;
  children: ReactNode;
  /** Rendered next to the label, e.g. an optional-field marker. */
  labelAction?: ReactNode;
  /** Shown below the field when there is no error. */
  hint?: ReactNode;
}

/**
 * Label + bordered input shell + error line, shared by the auth forms.
 *
 * The caller supplies the control so that inputs, selects, and date pickers can
 * all sit in the same shell. `signup-form.tsx` and `login-form.tsx` each had
 * their own copy of this before.
 */
export function AuthField({
  id,
  label,
  error,
  errorId,
  hasValue,
  icon,
  children,
  labelAction,
  hint,
}: AuthFieldProps) {
  const resolvedErrorId = errorId ?? `${id}-error`;

  return (
    <div className="space-y-2">
      {labelAction ? (
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={id} className={theme.auth.fieldLabel}>
            {label}
          </label>
          {labelAction}
        </div>
      ) : (
        <label htmlFor={id} className={theme.auth.fieldLabel}>
          {label}
        </label>
      )}

      <div
        className={`${theme.auth.fieldShell} ${
          error
            ? theme.auth.fieldError
            : hasValue
              ? theme.auth.fieldActive
              : theme.auth.fieldDefault
        }`}
      >
        {icon}
        {children}
      </div>

      {error ? (
        <FieldErrorMessage id={resolvedErrorId} message={error} />
      ) : hint ? (
        <p className={theme.auth.fieldText}>{hint}</p>
      ) : null}
    </div>
  );
}
