"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { authApi } from "@/lib/auth/api";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import type { LoginMfaPendingFlow } from "@/lib/auth/pending-flow";
import {
  formatRecoveryCodeInput,
  isCompleteRecoveryCode,
} from "@/lib/auth/recovery-code";
import {
  ApiClientError,
  type AuthResponseBody,
  type LoginMfaFactor,
} from "@/lib/auth/types";
import {
  getPasskeyAssertion,
  PasskeyCeremonyError,
  supportsPasskeys,
} from "@/lib/auth/webauthn";
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
  {
    title: string;
    intro: string;
    label: string;
    hint: string;
    switchLabel: string;
    placeholder: string;
    incomplete: string;
    incorrect: string;
  }
> = {
  passkey: {
    title: "Use your passkey",
    intro:
      "Your password checked out. Confirm it's you with a passkey saved on this device, your phone, or a security key.",
    label: "Passkey",
    hint: "Your browser will ask you to choose a passkey.",
    switchLabel: "Use a passkey",
    placeholder: "",
    incomplete: "",
    incorrect:
      "That passkey couldn't be verified. Try again, or use a different method.",
  },
  totp: {
    title: "Enter your authenticator code",
    intro:
      "Your password checked out. This account also needs a code from your authenticator app.",
    label: "Authenticator code",
    hint: "Open your authenticator app and enter the 6-digit code for Rentify.",
    switchLabel: "Use your authenticator app",
    placeholder: "123456",
    incomplete: "Enter the 6-digit code from your authenticator app.",
    incorrect:
      "That code is incorrect. Check your authenticator app and try again.",
  },
  recovery_code: {
    title: "Enter a recovery code",
    intro:
      "Your password checked out. Use one of the recovery codes you saved when you set up your authenticator app.",
    label: "Recovery code",
    hint: "Each code works once. We'll email you when one is used.",
    switchLabel: "Use a recovery code",
    placeholder: "XXXXX-XXXXX",
    incomplete: "Enter your 10-character recovery code.",
    incorrect:
      "That recovery code is incorrect or was already used. Check it and try again.",
  },
};

const PASSKEY_CANCELLED_MESSAGE =
  "The passkey prompt closed before it finished. Try again, or use a different method.";

function formatCode(value: string, factor: LoginMfaFactor): string {
  return factor === "recovery_code"
    ? formatRecoveryCodeInput(value)
    : value.replace(/\D/g, "").slice(0, 6);
}

function isCompleteCode(value: string, factor: LoginMfaFactor): boolean {
  return factor === "recovery_code"
    ? isCompleteRecoveryCode(value)
    : value.length === 6;
}

/**
 * Errors the user can fix by entering another code, shown on the field. A
 * 400 about anything else, such as the stored challenge token, cannot be fixed
 * from here, so it goes back to the sign-in form.
 */
function getCodeError(error: unknown, factor: LoginMfaFactor): string | null {
  if (!(error instanceof ApiClientError) || error.status !== 400) {
    return null;
  }

  if (error.code === "INVALID_MFA_CODE") {
    return FACTOR_COPY[factor].incorrect;
  }

  const details = error.details as Record<string, unknown> | undefined;
  const codeMessages = details?.code;

  if (error.code === "VALIDATION_ERROR" && Array.isArray(codeMessages)) {
    return typeof codeMessages[0] === "string"
      ? codeMessages[0]
      : FACTOR_COPY[factor].incomplete;
  }

  return null;
}

/**
 * The second step of a sign-in for an account with a passkey or an
 * authenticator app. It only ever holds the challenge token from the first
 * step, and switching between factors stays on this step.
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
  const [rememberDevice, setRememberDevice] = useState(false);
  const copy = FACTOR_COPY[flow.factor];
  // Sent only when ticked, so a backend without the option never sees it.
  const remember = rememberDevice ? { rememberDevice: true } : {};
  const isRecoveryCode = flow.factor === "recovery_code";
  const isPasskey = flow.factor === "passkey";
  const passkeysSupported = supportsPasskeys();
  const otherFactors = flow.availableFactors.filter(
    (factor) =>
      factor !== flow.factor && (factor !== "passkey" || passkeysSupported),
  );

  function handleFailure(error: unknown) {
    const nextCodeError = getCodeError(error, flow.factor);

    if (nextCodeError) {
      setCode("");
      if (isPasskey) {
        setGeneralError(nextCodeError);
      } else {
        setCodeError(nextCodeError);
      }
    } else if (
      error instanceof ApiClientError &&
      [400, 401, 403, 423].includes(error.status)
    ) {
      onFailure(error);
    } else if (error instanceof PasskeyCeremonyError) {
      setGeneralError(error.message);
    } else {
      setGeneralError(
        getApiErrorMessage(error, {
          action: isPasskey ? "check your passkey" : "check your code",
          fallback: isPasskey
            ? "We couldn't check your passkey right now. Please try again."
            : "We couldn't check your code right now. Please try again.",
        }),
      );
    }
  }

  async function handlePasskey() {
    setGeneralError(null);
    setPending(true);

    try {
      const { options } = await authApi.getLoginPasskeyOptions({
        mfaChallengeToken: flow.mfaChallengeToken,
      });
      const result = await getPasskeyAssertion(options);

      if (result.status === "cancelled") {
        setGeneralError(PASSKEY_CANCELLED_MESSAGE);
        return;
      }

      const session = await authApi.completeLoginMfa({
        mfaChallengeToken: flow.mfaChallengeToken,
        factor: "passkey",
        credential: result.credential,
        ...remember,
      });
      await onSuccess(session);
    } catch (error) {
      handleFailure(error);
    } finally {
      setPending(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGeneralError(null);

    if (flow.factor === "passkey") {
      return;
    }

    if (!isCompleteCode(code, flow.factor)) {
      setCodeError(copy.incomplete);
      return;
    }

    setCodeError(null);
    setPending(true);

    try {
      const session = await authApi.completeLoginMfa({
        mfaChallengeToken: flow.mfaChallengeToken,
        factor: flow.factor,
        code,
        ...remember,
      });
      await onSuccess(session);
    } catch (error) {
      handleFailure(error);
    } finally {
      setPending(false);
    }
  }

  const rememberDeviceField = flow.rememberDeviceDays ? (
    <label className="flex items-start gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3">
      <input
        type="checkbox"
        name="rememberDevice"
        checked={rememberDevice}
        onChange={(event) => setRememberDevice(event.target.checked)}
        disabled={pending}
        aria-labelledby="login-mfa-remember-label"
        aria-describedby="login-mfa-remember-hint"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 dark:border-slate-700 accent-slate-950 dark:accent-white"
      />
      <span>
        <span
          id="login-mfa-remember-label"
          className="block text-sm font-medium text-slate-900 dark:text-white"
        >
          Remember this device for {flow.rememberDeviceDays} days
        </span>
        <span
          id="login-mfa-remember-hint"
          className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400"
        >
          Skip this step when you sign in on this browser. Only tick this on a
          device you trust: changing your password or your sign-in methods turns
          it off.
        </span>
      </span>
    </label>
  ) : null;

  return (
    <div className="space-y-5">
      <div className={theme.auth.infoPanel}>
        <p className="text-sm font-semibold">{copy.title}</p>
        <p className="mt-2 text-sm leading-6">{copy.intro}</p>
      </div>

      {isPasskey ? (
        <div className="space-y-5">
          {generalError ? (
            <div role="alert" className={theme.auth.errorPanel}>
              {generalError}
            </div>
          ) : null}

          {passkeysSupported ? (
            <>
              {rememberDeviceField}
              <button
                type="button"
                onClick={() => void handlePasskey()}
                disabled={pending}
                className={theme.auth.primaryButton}
              >
                <span className="inline-flex items-center gap-2">
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                  {pending ? "Waiting for your passkey..." : "Use passkey"}
                </span>
              </button>
              <p className={theme.auth.fieldText}>{copy.hint}</p>
            </>
          ) : (
            <div role="status" className={theme.auth.errorPanel}>
              This browser can&apos;t use passkeys.
              {otherFactors.length > 0
                ? " Use a different method below, or sign in from a browser that supports them."
                : " Sign in from a browser that supports them."}
            </div>
          )}
        </div>
      ) : (
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
              key={flow.factor}
              id="loginMfaCode"
              name="loginMfaCode"
              type="text"
              inputMode={isRecoveryCode ? "text" : "numeric"}
              autoComplete={isRecoveryCode ? "off" : "one-time-code"}
              autoCapitalize={isRecoveryCode ? "characters" : undefined}
              spellCheck={false}
              autoFocus
              maxLength={isRecoveryCode ? undefined : 6}
              placeholder={copy.placeholder}
              aria-invalid={Boolean(codeError)}
              aria-describedby={
                codeError ? "login-mfa-code-error" : "login-mfa-code-hint"
              }
              value={code}
              onChange={(event) => {
                setCodeError(null);
                setCode(formatCode(event.target.value, flow.factor));
              }}
              className={`h-14 w-full rounded-2xl border bg-white dark:bg-slate-900 px-4 text-center text-slate-900 dark:text-white outline-none transition duration-200 placeholder:tracking-normal placeholder:text-slate-400 dark:placeholder:text-slate-500 ${
                isRecoveryCode
                  ? "font-mono text-lg tracking-wider"
                  : "text-[22px] tracking-[0.35em]"
              } ${
                codeError
                  ? theme.auth.fieldError
                  : code.length > 0
                    ? theme.auth.fieldActive
                    : theme.auth.fieldDefault
              }`}
            />

            {codeError ? (
              <p
                id="login-mfa-code-error"
                className={theme.auth.fieldErrorText}
              >
                {codeError}
              </p>
            ) : (
              <p id="login-mfa-code-hint" className={theme.auth.fieldText}>
                {copy.hint}
              </p>
            )}
          </div>

          {rememberDeviceField}

          <button
            type="submit"
            disabled={pending}
            className={theme.auth.primaryButton}
          >
            {pending ? "Verifying..." : "Verify and sign in"}
          </button>
        </form>
      )}

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
