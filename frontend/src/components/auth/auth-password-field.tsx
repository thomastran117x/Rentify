"use client";

import { useState, type ReactNode } from "react";
import {
  EyeClosedIcon,
  EyeOpenIcon,
  LockIcon,
} from "@/components/auth/auth-field-icons";
import { FieldErrorMessage } from "@/components/errors";
import { theme } from "@/styles/theme";

interface AuthPasswordFieldProps {
  id: string;
  name?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  error?: string;
  errorId?: string;
  /** Shown below the field when there is no error. */
  hint?: ReactNode;
  /** Rendered next to the label, e.g. login's "I can't log in" button. */
  labelAction?: ReactNode;
}

/**
 * Password input with a show/hide toggle.
 *
 * This markup was copied four times across the auth forms. The reveal state is
 * owned here because no caller needed to read it.
 */
export function AuthPasswordField({
  id,
  name,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  error,
  errorId,
  hint,
  labelAction,
}: AuthPasswordFieldProps) {
  const [visible, setVisible] = useState(false);
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
            : value.length > 0
              ? theme.auth.fieldActive
              : theme.auth.fieldDefault
        }`}
      >
        <div className={theme.auth.fieldIcon}>
          <LockIcon />
        </div>

        <input
          id={id}
          name={name ?? id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? resolvedErrorId : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={theme.auth.fieldInputWithAction}
        />

        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          className={theme.auth.iconButton}
        >
          {visible ? <EyeClosedIcon /> : <EyeOpenIcon />}
        </button>
      </div>

      {error ? (
        <FieldErrorMessage id={resolvedErrorId} message={error} />
      ) : hint ? (
        <p className={theme.auth.fieldText}>{hint}</p>
      ) : null}
    </div>
  );
}
