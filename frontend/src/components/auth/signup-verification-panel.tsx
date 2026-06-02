"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCaptchaPanel } from "@/components/auth/auth-captcha-panel";
import { useAuth } from "@/components/auth/auth-context";
import { useAuthCaptchaToken } from "@/lib/auth/captcha-store";
import { authApi } from "@/lib/auth/api";
import type { SignupVerificationPendingResult } from "@/lib/auth/types";
import { theme } from "@/styles/theme";

interface ApiErrorShape {
  status?: number;
  message?: string;
  body?: {
    error?: string;
    code?: string;
    details?: unknown;
  };
}

type VerificationFailureResult = {
  generalError: string | null;
  fieldError?: string;
};

function getVerificationFailureResult(
  error: unknown,
): VerificationFailureResult {
  const apiError = error as ApiErrorShape | undefined;
  const status = apiError?.status;
  const message = apiError?.body?.error ?? apiError?.message;
  const details = apiError?.body?.details as
    | { retryAfterSeconds?: number }
    | undefined;

  if (status === 400) {
    return {
      generalError: null,
      fieldError:
        message || "Enter the 6-digit verification code from your email.",
    };
  }

  if (status === 409) {
    return {
      generalError:
        message ||
        "This email has already been verified. Try signing in instead.",
      fieldError: undefined,
    };
  }

  if (status === 429) {
    const retryAfterSeconds = details?.retryAfterSeconds;

    return {
      generalError: retryAfterSeconds
        ? `A verification code was sent recently. Try again in ${retryAfterSeconds} seconds.`
        : message ||
          "A verification code was sent recently. Please wait before retrying.",
      fieldError: undefined,
    };
  }

  if (status !== undefined && status >= 500) {
    return {
      generalError:
        "Something went wrong on our side. Please try again in a moment.",
      fieldError: undefined,
    };
  }

  return {
    generalError:
      "We couldn't verify your email right now. Check your connection and try again.",
    fieldError: undefined,
  };
}

function getResendFailureResult(error: unknown): VerificationFailureResult {
  const apiError = error as ApiErrorShape | undefined;
  const status = apiError?.status;
  const code = apiError?.body?.code;
  const message = apiError?.body?.error ?? apiError?.message;
  const details = apiError?.body?.details as
    | { retryAfterSeconds?: number }
    | undefined;

  if (status === 400) {
    switch (code) {
      case "CAPTCHA_REQUIRED":
      case "CAPTCHA_MISSING":
        return {
          generalError:
            "Please complete the security check before requesting another code.",
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
            message || "We couldn't send another verification code right now.",
        };
    }
  }

  if (status === 429) {
    const retryAfterSeconds = details?.retryAfterSeconds;

    return {
      generalError: retryAfterSeconds
        ? `A verification code was sent recently. Try again in ${retryAfterSeconds} seconds.`
        : message ||
          "A verification code was sent recently. Please wait before retrying.",
    };
  }

  if (status !== undefined && status >= 500) {
    return {
      generalError:
        "Something went wrong on our side. Please try again in a moment.",
    };
  }

  return {
    generalError:
      "We couldn't resend the verification code right now. Check your connection and try again.",
  };
}

interface SignupVerificationPanelProps {
  result: SignupVerificationPendingResult;
  nextPath?: string;
}

export function SignupVerificationPanel({
  result,
  nextPath = "/",
}: SignupVerificationPanelProps) {
  const router = useRouter();
  const { setSession } = useAuth();

  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resentMessage, setResentMessage] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken, clearCaptchaToken] =
    useAuthCaptchaToken();
  const [captchaError, setCaptchaError] = useState<string | null>(null);

  async function handleVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedCode = code.trim();
    setGeneralError(null);
    setResentMessage(null);

    if (!/^\d{6}$/.test(normalizedCode)) {
      setCodeError("Enter the 6-digit verification code from your email.");
      return;
    }

    setCodeError(null);
    setPending(true);

    try {
      const session = await authApi.verifyEmail({
        email: result.email,
        code: normalizedCode,
      });

      setSession(session);
      router.replace(nextPath);
    } catch (error) {
      const failure = getVerificationFailureResult(error);
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
      await authApi.resendVerificationEmail({
        email: result.email,
        captchaToken,
      });

      setResentMessage(
        "If this email needs verification, a new code is on the way.",
      );
    } catch (error) {
      const failure = getResendFailureResult(error);
      setGeneralError(failure.generalError);
      setCaptchaError(failure.fieldError ?? null);
    } finally {
      clearCaptchaToken();
      setResending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className={theme.auth.successPanel}>
        <p className="text-sm font-semibold">Check your inbox</p>
        <p className="mt-2 text-sm leading-6">
          If {result.email} needs verification, we sent a 6-digit code.
        </p>
        <p className="mt-2 text-sm leading-6">
          Verify your email before signing in to your Rentify workspace.
        </p>
      </div>

      <form className="space-y-5" onSubmit={handleVerify}>
        {generalError ? (
          <div className={theme.auth.errorPanel}>{generalError}</div>
        ) : null}

        {resentMessage ? (
          <div className={theme.auth.infoPanel}>{resentMessage}</div>
        ) : null}

        <div className="space-y-2">
          <label htmlFor="verificationCode" className={theme.auth.fieldLabel}>
            Verification code
          </label>

          <input
            id="verificationCode"
            name="verificationCode"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            className={`h-14 w-full rounded-2xl border bg-white px-4 text-center text-[22px] tracking-[0.35em] text-slate-900 outline-none transition duration-200 placeholder:tracking-normal placeholder:text-slate-400 ${
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
              Enter the 6-digit code from your email to finish creating your
              account.
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={pending}
          className={theme.auth.primaryButton}
        >
          {pending ? "Verifying..." : "Verify email"}
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
        {resending ? "Sending new code..." : "Resend code"}
      </button>

      <Link
        href={`/login?next=${encodeURIComponent(nextPath)}`}
        className={theme.auth.tertiaryLink}
      >
        Back to sign in
      </Link>
    </div>
  );
}
