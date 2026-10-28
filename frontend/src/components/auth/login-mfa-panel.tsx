"use client";

import { useState } from "react";
import { authApi } from "@/lib/auth/api";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import type { LoginMfaPendingFlow } from "@/lib/auth/pending-flow";
import {
  ApiClientError,
  type AuthResponseBody,
  type LoginMfaFactor,
} from "@/lib/auth/types";
import { theme } from "@/styles/theme";

interface LoginMfaPanelProps {
  flow: LoginMfaPendingFlow;
  onSuccess: (session: AuthResponseBody) => void | Promise<void>;
  /** The step cannot go on (expired challenge, lock); the form takes over. */
  onFailure: (error: unknown) => void;
  onFactorChange: (factor: LoginMfaFactor) => void;
  onCancel: () => void;
}

const FACTOR_COPY: Record<
  LoginMfaFactor,
  { title: string; label: string; hint: string; switchLabel: string }
> = {
  totp: {
    title: "Enter your authenticator code",
    label: "Authenticator code",
    hint: "Open your authenticator app and enter the 6-digit code for Rentify.",
    switchLabel: "Use your authenticator app",
  },
};

/**
 * Errors the user can fix by entering another code, shown on the field. A
 * 400 about anything else, such as the stored challenge token, cannot be fixed
 * from here, so it goes back to the sign-in form.
 */
function getCodeError(error: unknown): string | null {
  if (!(error instanceof ApiClientError) || error.status !== 400) {
    return null;
  }

  if (error.code === "INVALID_MFA_CODE") {
    return "That code is incorrect. Check your authenticator app and try again.";
  }

  const details = error.details as Record<string, unknown> | undefined;
  const codeMessages = details?.code;

  if (error.code === "VALIDATION_ERROR" && Array.isArray(codeMessages)) {
    return typeof codeMessages[0] === "string"
      ? codeMessages[0]
      : "Enter the 6-digit code from your authenticator app.";
  }

  return null;
}

/**
 * The second step of a sign-in for an account with an authenticator app. It
 * only ever holds the challenge token from the first step.
 */
export function LoginMfaPanel({
  flow,
  onSuccess,
  onFailure,
  onFactorChange,
  onCancel,
}: LoginMfaPanelProps) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const copy = FACTOR_COPY[flow.factor];
  // Typed explicitly: with one factor today, the inferred predicate is `never`.
  const otherFactors: LoginMfaFactor[] = flow.availableFactors.filter(
    (factor) => factor !== flow.factor,
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGeneralError(null);

    if (code.length !== 6) {
      setCodeError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setCodeError(null);
    setPending(true);

    try {
      const session = await authApi.completeLoginMfa({
        mfaChallengeToken: flow.mfaChallengeToken,
        factor: flow.factor,
        code,
      });
      await onSuccess(session);
    } catch (error) {
      const nextCodeError = getCodeError(error);

      if (nextCodeError) {
        setCode("");
        setCodeError(nextCodeError);
      } else if (
        error instanceof ApiClientError &&
        [400, 401, 403, 423].includes(error.status)
      ) {
        onFailure(error);
      } else {
        setGeneralError(
          getApiErrorMessage(error, {
            action: "check your code",
            fallback:
              "We couldn't check your code right now. Please try again.",
          }),
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className={theme.auth.infoPanel}>
        <p className="text-sm font-semibold">{copy.title}</p>
        <p className="mt-2 text-sm leading-6">
          Your password checked out. This account also needs a code from your
          authenticator app.
        </p>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        {generalError ? (
          <div role="alert" className={theme.auth.errorPanel}>
            {generalError}
          </div>
        ) : null}

        <div className="space-y-2">
          <label htmlFor="loginMfaCode" className={theme.auth.fieldLabel}>
            {copy.label}
          </label>

          <input
            id="loginMfaCode"
            name="loginMfaCode"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            placeholder="123456"
            aria-invalid={Boolean(codeError)}
            aria-describedby={
              codeError ? "login-mfa-code-error" : "login-mfa-code-hint"
            }
            value={code}
            onChange={(event) => {
              setCodeError(null);
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
            }}
            className={`h-14 w-full rounded-2xl border bg-white dark:bg-slate-900 px-4 text-center text-[22px] tracking-[0.35em] text-slate-900 dark:text-white outline-none transition duration-200 placeholder:tracking-normal placeholder:text-slate-400 dark:placeholder:text-slate-500 ${
              codeError
                ? theme.auth.fieldError
                : code.length > 0
                  ? theme.auth.fieldActive
                  : theme.auth.fieldDefault
            }`}
          />

          {codeError ? (
            <p id="login-mfa-code-error" className={theme.auth.fieldErrorText}>
              {codeError}
            </p>
          ) : (
            <p id="login-mfa-code-hint" className={theme.auth.fieldText}>
              {copy.hint}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={pending}
          className={theme.auth.primaryButton}
        >
          {pending ? "Verifying..." : "Verify and sign in"}
        </button>
      </form>

      {otherFactors.length > 0 ? (
        <div className="space-y-2">
          <p className={theme.auth.fieldText}>Use a different method</p>
          {otherFactors.map((factor) => (
            <button
              key={factor}
              type="button"
              disabled={pending}
              onClick={() => {
                setCode("");
                setCodeError(null);
                setGeneralError(null);
                onFactorChange(factor);
              }}
              className={theme.auth.secondaryButton}
            >
              {FACTOR_COPY[factor].switchLabel}
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className={theme.auth.tertiaryLink}
      >
        Back to sign in
      </button>
    </div>
  );
}
