"use client";

import { useMemo, useState } from "react";
import { AuthCaptchaPanel } from "@/components/auth/auth-captcha-panel";
import { FieldErrorMessage, FormErrorMessage } from "@/components/errors";
import { useAuthCaptchaToken } from "@/lib/auth/captcha-store";
import { authApi } from "@/lib/auth/api";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { ApiClientError } from "@/lib/auth/types";
import { theme } from "@/styles/theme";

interface RequestErrors {
  email?: string;
  captchaToken?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRequest(values: {
  email: string;
  captchaToken: string;
}): RequestErrors {
  const errors: RequestErrors = {};
  const normalizedEmail = values.email.trim();

  if (!normalizedEmail) {
    errors.email = "Email is required.";
  } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
    errors.email = "Enter a valid email address.";
  }

  if (!values.captchaToken.trim()) {
    errors.captchaToken = "Complete the captcha before continuing.";
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
              "Please complete the security check before requesting your username.",
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
              message || "We couldn't send your username right now.",
          };
      }
    }
  }

  return {
    generalError: getApiErrorMessage(error, {
      action: "recover your username",
      fallback: "We couldn't send your username right now. Please try again.",
    }),
  };
}

export function ForgotUsernameForm() {
  const [email, setEmail] = useState("");
  const [requestErrors, setRequestErrors] = useState<RequestErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [requestPending, setRequestPending] = useState(false);
  const [requestComplete, setRequestComplete] = useState(false);
  const [captchaToken, setCaptchaToken, clearCaptchaToken] =
    useAuthCaptchaToken();

  function handleCaptchaChange(token: string) {
    setCaptchaToken(token);
  }

  function handleCaptchaReset() {
    clearCaptchaToken();
  }

  async function handleRequestSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateRequest({ email, captchaToken });
    setRequestErrors(nextErrors);
    setGeneralError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setRequestPending(true);

    try {
      await authApi.forgotUsername({
        email: email.trim().toLowerCase(),
        captchaToken,
      });

      // The captcha token is a shared store across auth forms and has now been
      // consumed by the backend. Clear it so a later sign-in or recovery attempt
      // doesn't reuse a spent token and fail server-side captcha verification.
      handleCaptchaReset();
      setRequestComplete(true);
      setGeneralError(null);
    } catch (error) {
      const failure = getRequestFailureResult(error);
      setGeneralError(failure.generalError);
      setRequestErrors((current) => ({
        ...current,
        ...(failure.fieldErrors ?? {}),
      }));
      handleCaptchaReset();
    } finally {
      setRequestPending(false);
    }
  }

  const emailHasValue = useMemo(() => email.trim().length > 0, [email]);

  if (requestComplete) {
    return (
      <div className={theme.auth.successPanel}>
        <p className="text-sm font-semibold">Check your inbox</p>
        <p className="mt-2 text-sm leading-6">
          If an account exists for that email, we&apos;ve sent its username to
          the address on file. Use it to sign in &mdash; and to reset your
          password if you ever need to.
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleRequestSubmit}>
      {generalError ? (
        <FormErrorMessage
          title="Couldn't send your username"
          message={generalError}
        />
      ) : null}

      <div className="space-y-2">
        <label
          htmlFor="forgot-username-email"
          className={theme.auth.fieldLabel}
        >
          Email
        </label>
        <input
          id="forgot-username-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={Boolean(requestErrors.email)}
          aria-describedby={
            requestErrors.email ? "forgot-username-email-error" : undefined
          }
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={`h-14 w-full rounded-2xl border bg-white dark:bg-slate-900 px-4 text-[15px] text-slate-900 dark:text-white outline-none transition duration-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 ${
            requestErrors.email
              ? theme.auth.fieldError
              : emailHasValue
                ? theme.auth.fieldActive
                : theme.auth.fieldDefault
          }`}
        />
        {requestErrors.email ? (
          <FieldErrorMessage
            id="forgot-username-email-error"
            message={requestErrors.email}
          />
        ) : (
          <p className={theme.auth.fieldText}>
            We&apos;ll email your username to this address if an account exists.
            Social sign-in accounts get the username generated when they were
            created.
          </p>
        )}
      </div>

      <AuthCaptchaPanel
        token={captchaToken}
        error={requestErrors.captchaToken}
        onChange={handleCaptchaChange}
        onReset={handleCaptchaReset}
      />

      <button
        type="submit"
        disabled={requestPending}
        className={theme.auth.primaryButton}
      >
        {requestPending ? "Sending username..." : "Email me my username"}
      </button>
    </form>
  );
}
