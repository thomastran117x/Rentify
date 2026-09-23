"use client";

import { useEffect, useState } from "react";
import { FieldErrorMessage, FormErrorMessage } from "@/components/errors";
import { authApi } from "@/lib/auth/api";
import {
  getCurrentUtcDateOnly,
  validateDateOfBirth,
} from "@/lib/auth/date-of-birth";
import type {
  AuthResponseBody,
  OAuthSignupRequiredResult,
} from "@/lib/auth/types";
import { ApiClientError } from "@/lib/auth/types";
import { theme } from "@/styles/theme";

interface OAuthSignupDateOfBirthDialogProps {
  pendingSignup: OAuthSignupRequiredResult;
  onSuccess: (session: AuthResponseBody) => void;
  onCancel: () => void;
}

export function OAuthSignupDateOfBirthDialog({
  pendingSignup,
  onSuccess,
  onCancel,
}: OAuthSignupDateOfBirthDialogProps) {
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, pending]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextError = validateDateOfBirth(dateOfBirth);
    setFieldError(nextError);
    setGeneralError(null);

    if (nextError) {
      return;
    }

    setPending(true);
    try {
      const session = await authApi.completeOAuthSignup({
        signupToken: pendingSignup.signupToken,
        dateOfBirth,
      });
      onSuccess(session);
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "OAUTH_SIGNUP_CONTINUATION_EXPIRED"
      ) {
        setGeneralError(
          "This social signup session expired. Close this dialog and start again.",
        );
      } else {
        setGeneralError(
          error instanceof Error
            ? error.message
            : "We couldn't finish creating your account. Please try again.",
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="oauth-signup-date-title"
    >
      <div className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <p className={theme.auth.cardEyebrow}>Complete your account</p>
        <h2
          id="oauth-signup-date-title"
          className={`mt-2 ${theme.auth.cardTitle}`}
        >
          Add your date of birth
        </h2>
        <p className={`mt-3 ${theme.auth.cardDescription}`}>
          Rentify records this for age-aware marketplace experiences. It does
          not prevent people under 18 from creating an account.
        </p>

        <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
          {generalError ? (
            <FormErrorMessage
              title="Couldn't complete signup"
              message={generalError}
            />
          ) : null}

          <div className="space-y-2">
            <label
              htmlFor="oauth-signup-date-of-birth"
              className={theme.auth.fieldLabel}
            >
              Date of birth
            </label>
            <div
              className={`${theme.auth.fieldShell} ${
                fieldError
                  ? theme.auth.fieldError
                  : dateOfBirth
                    ? theme.auth.fieldActive
                    : theme.auth.fieldDefault
              }`}
            >
              <input
                autoFocus
                id="oauth-signup-date-of-birth"
                name="dateOfBirth"
                type="date"
                autoComplete="bday"
                max={getCurrentUtcDateOnly()}
                value={dateOfBirth}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={
                  fieldError ? "oauth-signup-date-of-birth-error" : undefined
                }
                onChange={(event) => {
                  setDateOfBirth(event.target.value);
                  if (fieldError) {
                    setFieldError(null);
                  }
                }}
                className={theme.auth.fieldInput}
              />
            </div>
            <FieldErrorMessage
              id="oauth-signup-date-of-birth-error"
              message={fieldError ?? undefined}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className={theme.auth.secondaryButton}
              disabled={pending}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={theme.auth.primaryButton}
              disabled={pending}
            >
              {pending ? "Creating account..." : "Create account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
