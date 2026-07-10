"use client";

import { useState } from "react";
import { AuthCaptchaPanel } from "@/components/auth/auth-captcha-panel";
import { useAuthCaptchaToken } from "@/lib/auth/captcha-store";
import { authApi } from "@/lib/auth/api";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { ApiClientError } from "@/lib/auth/types";
import { theme } from "@/styles/theme";

interface LoginUnlockPanelProps {
  email: string;
  onUnlocked: (message: string) => void;
  onCancel: () => void;
}

function getUnlockFailureResult(error: unknown): {
  generalError: string | null;
  fieldError?: string;
} {
  if (error instanceof ApiClientError) {
    const { status, message, details } = error;
    const retryDetails = details as { retryAfterSeconds?: number } | undefined;

    if (status === 400) {
      return {
        generalError: null,
        fieldError: message || "Enter the 6-digit unlock code from your email.",
      };
    }

    if (status === 429) {
      const retryAfterSeconds = retryDetails?.retryAfterSeconds;

      return {
        generalError: retryAfterSeconds
          ? `A new unlock code was sent recently. Try again in ${retryAfterSeconds} seconds.`
          : message ||
            "A new unlock code was sent recently. Please wait before retrying.",
        fieldError: undefined,
      };
    }
  }

  return {
    generalError: getApiErrorMessage(error, {
      action: "unlock sign-in",
      fallback: "We couldn't unlock sign-in right now. Please try again.",
    }),
    fieldError: undefined,
  };
}

function getResendUnlockFailureResult(error: unknown): {
  generalError: string | null;
  fieldError?: string;
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
              "Please complete the security check before requesting another unlock code.",
            fieldError: "Complete the verification to continue.",
          };
        case "CAPTCHA_INVALID":
        case "CAPTCHA_EXPIRED":
        case "TURNSTILE_VALIDATION_FAILED":
          return {
            generalError:
              "The security check expired or failed. Please try again.",
            fieldError: "Please complete the verification again.",
          };
        default:
          return {
            generalError:
              message || "We couldn't send another unlock code right now.",
          };
      }
    }

    if (status === 429) {
      const retryAfterSeconds = retryDetails?.retryAfterSeconds;

      return {
        generalError: retryAfterSeconds
          ? `A new unlock code was sent recently. Try again in ${retryAfterSeconds} seconds.`
          : message ||
            "A new unlock code was sent recently. Please wait before retrying.",
        fieldError: undefined,
      };
    }
  }

  return {
    generalError: getApiErrorMessage(error, {
      action: "resend the unlock code",
      fallback:
        "We couldn't resend the unlock code right now. Please try again.",
    }),
    fieldError: undefined,
  };
}

export function LoginUnlockPanel({
  email,
  onUnlocked,
  onCancel,
}: LoginUnlockPanelProps) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resentMessage, setResentMessage] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken, clearCaptchaToken] =
    useAuthCaptchaToken();
  const [captchaError, setCaptchaError] = useState<string | null>(null);

  async function handleUnlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedCode = code.trim();
    setGeneralError(null);
    setResentMessage(null);

    if (!/^\d{6}$/.test(normalizedCode)) {
      setCodeError("Enter the 6-digit unlock code from your email.");
      return;
    }

    setCodeError(null);
    setPending(true);

    try {
      await authApi.unlockLocalLogin({
        email,
        code: normalizedCode,
      });

      onUnlocked("Sign-in unlocked. Try your password again.");
    } catch (error) {
      const failure = getUnlockFailureResult(error);
      setGeneralError(failure.generalError);
      setCodeError(failure.fieldError ?? null);
    } finally {
      setPending(false);
    }
  }

  async function handleResend() {
    setGeneralError(null);
    setCodeError(null);
    setResentMessage(null);
    setCaptchaError(null);

    if (!captchaToken.trim()) {
      setCaptchaError("Complete the verification to continue.");
      return;
    }

    setResending(true);

    try {
      await authApi.resendUnlockLocalLogin({
        email,
        captchaToken,
      });
      setResentMessage(
        "If sign-in is locked for this email, a new unlock code is on the way.",
      );
    } catch (error) {
      const failure = getResendUnlockFailureResult(error);
      setGeneralError(failure.generalError);
      setCaptchaError(failure.fieldError ?? null);
    } finally {
      clearCaptchaToken();
      setResending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className={theme.auth.warningPanel}>
        <p className="text-sm font-semibold">Sign-in temporarily locked</p>
        <p className="mt-2 text-sm leading-6">
          We sent an unlock code to {email}. Enter it below to restore local
          sign-in.
        </p>
      </div>

      <form className="space-y-5" onSubmit={handleUnlock}>
        {generalError ? (
          <div className={theme.auth.errorPanel}>{generalError}</div>
        ) : null}

        {resentMessage ? (
          <div className={theme.auth.infoPanel}>{resentMessage}</div>
        ) : null}

        <div className="space-y-2">
          <label htmlFor="unlockCode" className={theme.auth.fieldLabel}>
            Unlock code
          </label>

          <input
            id="unlockCode"
            name="unlockCode"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            className={`h-14 w-full rounded-2xl border bg-white dark:bg-slate-900 px-4 text-center text-[22px] tracking-[0.35em] text-slate-900 dark:text-white outline-none transition duration-200 placeholder:tracking-normal placeholder:text-slate-400 dark:placeholder:text-slate-500 ${
              codeError
                ? theme.auth.fieldError
                : code.length > 0
                  ? theme.auth.fieldActive
                  : theme.auth.fieldDefault
            }`}
          />

          {codeError ? (
            <p className={theme.auth.fieldErrorText}>{codeError}</p>
          ) : null}
          {!codeError ? (
            <p className={theme.auth.fieldText}>
              Enter the 6-digit code from your email to unlock local sign-in.
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={pending}
          className={theme.auth.primaryButton}
        >
          {pending ? "Unlocking..." : "Unlock sign-in"}
        </button>
      </form>

      <AuthCaptchaPanel
        token={captchaToken}
        error={captchaError ?? undefined}
        onChange={(token) => {
          setCaptchaError(null);
          setCaptchaToken(token);
        }}
        onReset={() => {
          setCaptchaError(null);
          clearCaptchaToken();
        }}
      />

      <button
        type="button"
        onClick={handleResend}
        disabled={resending}
        className={theme.auth.secondaryButton}
      >
        {resending ? "Sending new code..." : "Resend unlock code"}
      </button>

      <button
        type="button"
        onClick={onCancel}
        className={theme.auth.tertiaryLink}
      >
        Back to sign in
      </button>
    </div>
  );
}
