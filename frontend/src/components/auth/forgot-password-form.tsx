"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCaptchaPanel } from "@/components/auth/auth-captcha-panel";
import { AuthPasswordField } from "@/components/auth/auth-password-field";
import { useAuth } from "@/components/auth/auth-context";
import { PasswordRequirementsChecklist } from "@/components/auth/password-requirements-checklist";
import { FieldErrorMessage, FormErrorMessage } from "@/components/errors";
import { CAPTCHA_ACTIONS } from "@/lib/auth/captcha-actions";
import { useAuthCaptchaToken } from "@/lib/auth/captcha-store";
import {
  clearPersistedAuthPendingFlowByType,
  usePersistedAuthPendingFlow,
  writePersistedAuthPendingFlow,
} from "@/lib/auth/pending-flow";
import { authApi } from "@/lib/auth/api";
import { getPasswordStrengthError } from "@/lib/auth/password";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { ApiClientError, type AuthResponseBody } from "@/lib/auth/types";
import { validateUsernameFormat } from "@/lib/auth/username";
import { theme } from "@/styles/theme";

interface RequestErrors {
  username?: string;
  captchaToken?: string;
}

interface ResetErrors {
  code?: string;
  newPassword?: string;
  confirmPassword?: string;
  captchaToken?: string;
}

function validateRequest(values: {
  username: string;
  captchaToken: string;
}): RequestErrors {
  const errors: RequestErrors = {};
  const usernameError = validateUsernameFormat(values.username);

  if (usernameError) {
    errors.username = usernameError;
  }

  if (!values.captchaToken.trim()) {
    errors.captchaToken = "Complete the captcha before continuing.";
  }

  return errors;
}

function validateReset(values: {
  code: string;
  newPassword: string;
  confirmPassword: string;
}): ResetErrors {
  const errors: ResetErrors = {};

  if (!/^\d{6}$/.test(values.code.trim())) {
    errors.code = "Enter the 6-digit reset code from your email.";
  }

  if (!values.newPassword) {
    errors.newPassword = "New password is required.";
  } else {
    // `resetPasswordSchema` uses the same `strongPasswordSchema` as signup.
    const passwordError = getPasswordStrengthError(values.newPassword);

    if (passwordError) {
      errors.newPassword = passwordError;
    }
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Please confirm your new password.";
  } else if (values.newPassword !== values.confirmPassword) {
    errors.confirmPassword = "Passwords do not match.";
  }

  return errors;
}

function getRequestFailureResult(error: unknown): {
  generalError: string | null;
  fieldErrors?: Partial<RequestErrors>;
} {
  if (error instanceof ApiClientError) {
    const { status, code, message } = error;

    if (status === 400) {
      switch (code) {
        case "CAPTCHA_REQUIRED":
        case "CAPTCHA_MISSING":
          return {
            generalError:
              "Please complete the security check before requesting a reset code.",
            fieldErrors: {
              captchaToken: "Complete the verification to continue.",
            },
          };
        case "CAPTCHA_INVALID":
        case "CAPTCHA_EXPIRED":
        case "TURNSTILE_VALIDATION_FAILED":
          return {
            generalError:
              "The security check expired or failed. Please try again.",
            fieldErrors: {
              captchaToken: "Please complete the verification again.",
            },
          };
        default:
          return {
            generalError:
              message || "We couldn't start password reset right now.",
          };
      }
    }
  }

  return {
    generalError: getApiErrorMessage(error, {
      action: "start password reset",
      fallback: "We couldn't start password reset right now. Please try again.",
    }),
  };
}

function getResetFailureResult(error: unknown): {
  generalError: string | null;
  fieldErrors?: Partial<ResetErrors>;
} {
  if (error instanceof ApiClientError) {
    const { status, code, message, details } = error;
    const retryDetails = details as { retryAfterSeconds?: number } | undefined;

    if (status === 400) {
      switch (code) {
        case "CAPTCHA_REQUIRED":
        case "CAPTCHA_MISSING":
          return {
            generalError:
              "Please complete the security check before requesting another reset code.",
            fieldErrors: {
              captchaToken: "Complete the verification to continue.",
            },
          };
        case "CAPTCHA_INVALID":
        case "CAPTCHA_EXPIRED":
        case "TURNSTILE_VALIDATION_FAILED":
          return {
            generalError:
              "The security check expired or failed. Please try again.",
            fieldErrors: {
              captchaToken: "Please complete the verification again.",
            },
          };
        default:
          return {
            generalError: null,
            fieldErrors: {
              code: message || "Reset code is invalid or has expired.",
            },
          };
      }
    }

    if (status === 409) {
      return {
        generalError:
          message || "This account is not eligible for password reset.",
      };
    }

    if (status === 429) {
      const retryAfterSeconds = retryDetails?.retryAfterSeconds;
      return {
        generalError: retryAfterSeconds
          ? `A reset code was sent recently. Try again in ${retryAfterSeconds} seconds.`
          : message ||
            "A reset code was sent recently. Please wait before retrying.",
      };
    }
  }

  return {
    generalError: getApiErrorMessage(error, {
      action: "reset your password",
      fallback: "We couldn't reset your password right now. Please try again.",
    }),
  };
}

export function ForgotPasswordForm() {
  const router = useRouter();
  const { status, setSession } = useAuth();

  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [requestErrors, setRequestErrors] = useState<RequestErrors>({});
  const [resetErrors, setResetErrors] = useState<ResetErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [resentMessage, setResentMessage] = useState<string | null>(null);
  const [requestPending, setRequestPending] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [resending, setResending] = useState(false);
  // Turnstile tokens are single-use, so every request that reaches the
  // server clears this one. The widget then renews it: a fresh challenge with
  // a site key, or the development bypass token without one.
  const [captchaToken, setCaptchaToken, clearCaptchaToken] =
    useAuthCaptchaToken(CAPTCHA_ACTIONS.passwordReset);
  const persistedAuthFlow = usePersistedAuthPendingFlow();
  const resetFlow =
    persistedAuthFlow?.flow === "forgot-password-reset"
      ? persistedAuthFlow
      : null;
  const requestComplete = resetFlow !== null;
  const authFlowRestorePending = persistedAuthFlow === undefined;

  useEffect(() => {
    if (status === "authenticated") {
      clearPersistedAuthPendingFlowByType("forgot-password-reset");
      router.replace("/");
    }
  }, [router, status]);

  async function handleRequestSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateRequest({ username, captchaToken });
    setRequestErrors(nextErrors);
    setGeneralError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setRequestPending(true);

    try {
      await authApi.forgotPassword({
        username: username.trim().toLowerCase(),
        captchaToken,
      });

      writePersistedAuthPendingFlow({
        flow: "forgot-password-reset",
        username: username.trim().toLowerCase(),
      });
      setGeneralError(null);
    } catch (error) {
      const failure = getRequestFailureResult(error);
      setGeneralError(failure.generalError);
      setRequestErrors((current) => ({
        ...current,
        ...(failure.fieldErrors ?? {}),
      }));
    } finally {
      clearCaptchaToken();
      setRequestPending(false);
    }
  }

  async function handleResetSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateReset({ code, newPassword, confirmPassword });

    if (!captchaToken.trim()) {
      nextErrors.captchaToken = "Complete the verification to continue.";
    }

    setResetErrors(nextErrors);
    setGeneralError(null);
    setResentMessage(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setResetPending(true);

    try {
      const session: AuthResponseBody = await authApi.resetPassword({
        username: resetFlow?.username ?? username.trim().toLowerCase(),
        code: code.trim(),
        newPassword,
        captchaToken,
      });

      clearPersistedAuthPendingFlowByType("forgot-password-reset");
      setSession(session);
      router.replace("/");
    } catch (error) {
      const failure = getResetFailureResult(error);
      setGeneralError(failure.generalError);
      setResetErrors((current) => ({
        ...current,
        ...(failure.fieldErrors ?? {}),
      }));
    } finally {
      clearCaptchaToken();
      setResetPending(false);
    }
  }

  async function handleResend() {
    setGeneralError(null);
    setResetErrors({});
    setResentMessage(null);

    if (!captchaToken.trim()) {
      setResetErrors({
        captchaToken: "Complete the verification to continue.",
      });
      return;
    }

    setResending(true);

    try {
      await authApi.resendForgotPassword({
        username: resetFlow?.username ?? username.trim().toLowerCase(),
        captchaToken,
      });

      setResentMessage(
        "If that username is eligible, a new reset code is on the way.",
      );
    } catch (error) {
      const failure = getResetFailureResult(error);
      setGeneralError(failure.generalError);
      setResetErrors((current) => ({
        ...current,
        ...(failure.fieldErrors ?? {}),
      }));
    } finally {
      clearCaptchaToken();
      setResending(false);
    }
  }

  const usernameHasValue = useMemo(
    () => username.trim().length > 0,
    [username],
  );

  if (status === "loading" || authFlowRestorePending) {
    return (
      <div className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3 text-sm font-medium text-slate-600 dark:text-slate-300 shadow-sm">
        Preparing your workspace...
      </div>
    );
  }

  if (status === "authenticated") {
    return null;
  }

  if (!requestComplete) {
    return (
      <form className="space-y-5" onSubmit={handleRequestSubmit}>
        {generalError ? (
          <FormErrorMessage
            title="Couldn't send a reset code"
            message={generalError}
          />
        ) : null}

        <div className="space-y-2">
          <label htmlFor="username" className={theme.auth.fieldLabel}>
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            placeholder="your-username"
            aria-invalid={Boolean(requestErrors.username)}
            aria-describedby={
              requestErrors.username
                ? "forgot-password-request-username-error"
                : undefined
            }
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className={`h-14 w-full rounded-2xl border bg-white dark:bg-slate-900 px-4 text-[15px] text-slate-900 dark:text-white outline-none transition duration-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 ${
              requestErrors.username
                ? theme.auth.fieldError
                : usernameHasValue
                  ? theme.auth.fieldActive
                  : theme.auth.fieldDefault
            }`}
          />
          {requestErrors.username ? (
            <FieldErrorMessage
              id="forgot-password-request-username-error"
              message={requestErrors.username}
            />
          ) : (
            <p className={theme.auth.fieldText}>
              We&apos;ll email a reset code to the address on file if this
              account can use local password sign-in.
            </p>
          )}
        </div>

        <AuthCaptchaPanel
          action={CAPTCHA_ACTIONS.passwordReset}
          token={captchaToken}
          error={requestErrors.captchaToken}
          onChange={setCaptchaToken}
          onReset={clearCaptchaToken}
        />

        <button
          type="submit"
          disabled={requestPending}
          className={theme.auth.primaryButton}
        >
          {requestPending ? "Sending code..." : "Send reset code"}
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      <div className={theme.auth.successPanel}>
        <p className="text-sm font-semibold">Check your inbox</p>
        <p className="mt-2 text-sm leading-6">
          If that username is eligible for local password reset, we sent a
          6-digit code to the email on file.
        </p>
      </div>

      <form className="space-y-5" onSubmit={handleResetSubmit}>
        {generalError ? (
          <FormErrorMessage
            title="Couldn't reset your password"
            message={generalError}
          />
        ) : null}

        {resentMessage ? (
          <FormErrorMessage tone="info" message={resentMessage} />
        ) : null}

        <div className="space-y-2">
          <label htmlFor="code" className={theme.auth.fieldLabel}>
            Reset code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            aria-invalid={Boolean(resetErrors.code)}
            aria-describedby={
              resetErrors.code ? "forgot-password-code-error" : undefined
            }
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            className={`h-14 w-full rounded-2xl border bg-white dark:bg-slate-900 px-4 text-center text-[22px] tracking-[0.35em] text-slate-900 dark:text-white outline-none transition duration-200 placeholder:tracking-normal placeholder:text-slate-400 dark:placeholder:text-slate-500 ${
              resetErrors.code
                ? theme.auth.fieldError
                : code.length > 0
                  ? theme.auth.fieldActive
                  : theme.auth.fieldDefault
            }`}
          />
          <FieldErrorMessage
            id="forgot-password-code-error"
            message={resetErrors.code}
          />
        </div>

        <AuthPasswordField
          id="newPassword"
          label="New password"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          placeholder="Create a password"
          error={resetErrors.newPassword}
          errorId="forgot-password-new-password-error"
          requirementsId="forgot-password-new-password-requirements"
          requirements={
            <PasswordRequirementsChecklist
              id="forgot-password-new-password-requirements"
              password={newPassword}
              invalid={Boolean(resetErrors.newPassword)}
            />
          }
        />

        <AuthPasswordField
          id="confirmPassword"
          label="Confirm new password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          placeholder="Repeat your new password"
          error={resetErrors.confirmPassword}
          errorId="forgot-password-confirm-password-error"
        />

        <AuthCaptchaPanel
          action={CAPTCHA_ACTIONS.passwordReset}
          token={captchaToken}
          error={resetErrors.captchaToken}
          onChange={(token) => {
            setResetErrors((current) => ({
              ...current,
              captchaToken: undefined,
            }));
            setCaptchaToken(token);
          }}
          onReset={() => {
            setResetErrors((current) => ({
              ...current,
              captchaToken: undefined,
            }));
            clearCaptchaToken();
          }}
        />

        <button
          type="submit"
          disabled={resetPending}
          className={theme.auth.primaryButton}
        >
          {resetPending ? "Resetting password..." : "Reset password"}
        </button>
      </form>

      <button
        type="button"
        onClick={handleResend}
        disabled={resending}
        className={theme.auth.secondaryButton}
      >
        {resending ? "Sending new code..." : "Resend reset code"}
      </button>
    </div>
  );
}
