"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { MfaVerificationDialog } from "@/components/auth/mfa-verification-dialog";
import { FieldErrorMessage } from "@/components/errors";
import { isApiClientError, isApiRateLimitError } from "@/lib/api/types";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { emailChangeApi } from "@/lib/auth/email-change-api";
import {
  EMAIL_MAX_LENGTH,
  normalizeEmail,
  validateEmailFormat,
} from "@/lib/auth/email";
import {
  type MfaVerificationOptionsResult,
  type MfaVerificationScope,
  mfaVerificationApi,
} from "@/lib/auth/mfa-verification-api";

const MFA_SCOPE: MfaVerificationScope = "mfa-management";
const CODE_LENGTH = 6;

type Step =
  | { kind: "idle" }
  | { kind: "editing" }
  | { kind: "confirming"; email: string };

/**
 * Turns an error from any of the change endpoints into copy a person can act
 * on. The backend already writes user-facing text for the conflict cases, so
 * those are passed through rather than restated.
 */
/** `details.reason` on the 429 a spent attempt budget answers with. */
const OTP_ATTEMPTS_EXHAUSTED_REASON = "otp-attempts-exhausted";

export function getEmailChangeErrorMessage(
  error: unknown,
  action: string,
): string {
  if (isApiRateLimitError(error)) {
    const details = error.details as
      | { retryAfterSeconds?: number; reason?: string }
      | undefined;
    const retryAfter = details?.retryAfterSeconds;

    // A resend keeps the attempt count, so once it is spent no new code is
    // issued until the count expires, which can be several minutes away.
    if (details?.reason === OTP_ATTEMPTS_EXHAUSTED_REASON) {
      const minutes = retryAfter ? Math.ceil(retryAfter / 60) : null;

      return minutes
        ? `Too many incorrect codes. You can request a new code in ${minutes} ${
            minutes === 1 ? "minute" : "minutes"
          }.`
        : "Too many incorrect codes. Please try again later.";
    }

    return retryAfter
      ? `A code was sent recently. Try again in ${retryAfter} seconds.`
      : "A code was sent recently. Try again in a moment.";
  }

  if (isApiClientError(error)) {
    if (
      error.code === "EMAIL_CHANGE_ADDRESS_UNAVAILABLE" ||
      error.code === "EMAIL_CHANGE_SAME_ADDRESS" ||
      error.code === "EMAIL_CHANGE_NOT_PENDING"
    ) {
      return error.message;
    }

    const attemptsRemaining = (
      error.details as { attemptsRemaining?: number } | undefined
    )?.attemptsRemaining;

    if (error.status === 400 && typeof attemptsRemaining === "number") {
      return attemptsRemaining > 0
        ? `That code is not right. ${attemptsRemaining} ${
            attemptsRemaining === 1 ? "attempt" : "attempts"
          } left.`
        : "That code is not right, and you have run out of attempts. You can request a new code once this one expires.";
    }
  }

  return getApiErrorMessage(error, {
    action,
    fallback: "We couldn't do that right now. Please try again.",
    preserveClientMessage: true,
  });
}

export function AccountEmailPanel() {
  const { status, session, setSession } = useAuth();
  const currentEmail = session?.user.email ?? "";

  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">(
    "success",
  );
  const [pending, setPending] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [dialogOptions, setDialogOptions] =
    useState<MfaVerificationOptionsResult | null>(null);
  const verificationResolverRef = useRef<((value: boolean) => void) | null>(
    null,
  );

  /**
   * The pending record lives in Redis on the server, so it is the authority on
   * whether a confirmation step should be showing — not anything this component
   * kept in memory. That is what makes the flow survive a reload.
   */
  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    let active = true;

    emailChangeApi
      .pending()
      .then((result) => {
        if (active && result.pending && result.newEmail) {
          setStep({ kind: "confirming", email: result.newEmail });
        }
      })
      .catch(() => {
        // Nothing to restore is the overwhelmingly common case, and a failed
        // probe should not put an error banner on a tab the user just opened.
      });

    return () => {
      active = false;
    };
  }, [status]);

  /**
   * The remaining cooldown is derived during render rather than stored, so the
   * effect only has to keep a clock ticking. Holding the countdown in state
   * would mean writing it from inside the effect, which is the cascading-render
   * pattern the React compiler flags.
   */
  const resendSeconds =
    resendAt === null ? 0 : Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (resendAt === null || resendAt <= now) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [resendAt, now]);

  /**
   * Resets the clock alongside the deadline. Without that the first rendered
   * value would be measured against whenever `now` last ticked, which can be a
   * whole second stale.
   */
  function startResendCooldown(seconds: number) {
    const startedAt = Date.now();
    setNow(startedAt);
    setResendAt(startedAt + seconds * 1000);
  }

  const closeDialogWith = useCallback((result: boolean) => {
    setDialogOptions(null);
    verificationResolverRef.current?.(result);
    verificationResolverRef.current = null;
  }, []);

  /**
   * The Security tab establishes a step-up proof before this panel renders, but
   * that proof lapses after 15 minutes. Re-prompt instead of surfacing the 401.
   */
  async function ensureMfaProof(
    initialOptions?: MfaVerificationOptionsResult,
  ): Promise<boolean> {
    try {
      const options =
        initialOptions ?? (await mfaVerificationApi.getOptions(MFA_SCOPE));

      if (options.verified) {
        return true;
      }

      if (options.availableFactors.length === 0) {
        setMessageTone("error");
        setMessage(
          "We couldn't verify your identity because no verification methods are available for this account. Please contact support.",
        );
        return false;
      }

      return await new Promise<boolean>((resolve) => {
        verificationResolverRef.current = resolve;
        setDialogOptions(options);
      });
    } catch (error) {
      setMessageTone("error");
      setMessage(
        getApiErrorMessage(error, {
          action: "verify your identity",
          fallback:
            "We couldn't verify your identity right now. Please try again.",
          preserveClientMessage: true,
        }),
      );
      return false;
    }
  }

  function startEditing() {
    setStep({ kind: "editing" });
    setNewEmail("");
    setEmailError(null);
    setMessage(null);
  }

  function returnToIdle() {
    setStep({ kind: "idle" });
    setNewEmail("");
    setCode("");
    setEmailError(null);
    setCodeError(null);
    setResendAt(null);
  }

  async function handleRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalized = normalizeEmail(newEmail);
    const formatError = validateEmailFormat(newEmail);

    setMessage(null);

    if (formatError) {
      setEmailError(formatError);
      return;
    }

    if (normalized === normalizeEmail(currentEmail)) {
      setEmailError("That is already the email address on this account.");
      return;
    }

    setEmailError(null);
    setPending(true);

    try {
      const result = await emailChangeApi
        .request(normalized)
        .catch(async (error: unknown) => {
          if (
            !isApiClientError(error) ||
            error.code !== "MFA_VERIFICATION_REQUIRED"
          ) {
            throw error;
          }

          const details = error.details as
            | Pick<
                MfaVerificationOptionsResult,
                | "scope"
                | "availableFactors"
                | "recommendedFactor"
                | "verifiedUntil"
              >
            | undefined;
          const verified = await ensureMfaProof(
            details ? { ...details, verified: false } : undefined,
          );

          return verified ? emailChangeApi.request(normalized) : null;
        });

      if (!result) {
        return;
      }

      setStep({ kind: "confirming", email: normalized });
      setCode("");
      setCodeError(null);
      startResendCooldown(result.resendAvailableInSeconds);
      setMessageTone("success");
      setMessage(
        `We sent a 6-digit code to ${normalized}. Enter it below to finish the change.`,
      );
    } catch (error) {
      // There is no live availability check, so this request is where a taken
      // address is first reported. It belongs on the field, not in a banner.
      if (
        isApiClientError(error) &&
        error.code === "EMAIL_CHANGE_ADDRESS_UNAVAILABLE"
      ) {
        setEmailError(error.message);
        return;
      }

      setMessageTone("error");
      setMessage(getEmailChangeErrorMessage(error, "change your email"));
    } finally {
      setPending(false);
    }
  }

  async function handleConfirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!/^\d{6}$/.test(code.trim())) {
      setCodeError("Enter the 6-digit code we emailed you.");
      return;
    }

    setCodeError(null);
    setMessage(null);
    setPending(true);

    try {
      const result = await emailChangeApi.confirm(code.trim());

      // The confirm response is a whole new session, so every other place the
      // address is displayed updates from this one call.
      setSession(result);
      returnToIdle();
      setMessageTone("success");
      setMessage(
        `Your email is now ${result.user.email}. Other sessions were signed out.`,
      );
    } catch (error) {
      if (
        isApiClientError(error) &&
        error.code === "EMAIL_CHANGE_NOT_PENDING"
      ) {
        returnToIdle();
        setMessageTone("error");
        setMessage(getEmailChangeErrorMessage(error, "change your email"));
        return;
      }

      setCodeError(getEmailChangeErrorMessage(error, "confirm your new email"));
    } finally {
      setPending(false);
    }
  }

  async function handleResend() {
    setPending(true);
    setMessage(null);
    setCodeError(null);

    try {
      const result = await emailChangeApi.resend();
      startResendCooldown(result.resendAvailableInSeconds);
      setMessageTone("success");
      setMessage("We sent another code to your new address.");
    } catch (error) {
      if (isApiRateLimitError(error)) {
        const retryAfter = (
          error.details as { retryAfterSeconds?: number } | undefined
        )?.retryAfterSeconds;

        if (retryAfter) {
          startResendCooldown(retryAfter);
        }
      }

      setMessageTone("error");
      setMessage(getEmailChangeErrorMessage(error, "re-send the code"));
    } finally {
      setPending(false);
    }
  }

  async function handleCancel() {
    setPending(true);

    try {
      await emailChangeApi.cancel();
      returnToIdle();
      setMessageTone("success");
      setMessage("Email change cancelled. Your address is unchanged.");
    } catch (error) {
      setMessageTone("error");
      setMessage(getEmailChangeErrorMessage(error, "cancel the change"));
    } finally {
      setPending(false);
    }
  }

  if (status !== "authenticated") {
    return null;
  }

  return (
    <>
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Current email
          </p>
          <p
            data-testid="account-current-email"
            className="mt-1 text-sm font-medium text-slate-900 dark:text-white"
          >
            {currentEmail}
          </p>
        </div>

        {message ? (
          <div
            role="status"
            className={`rounded-xl border px-4 py-3 text-sm ${
              messageTone === "success"
                ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200"
                : "border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200"
            }`}
          >
            {message}
          </div>
        ) : null}

        {step.kind === "idle" ? (
          <button
            type="button"
            onClick={startEditing}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 px-5 text-sm font-semibold text-slate-900 dark:text-white transition hover:border-slate-300 dark:hover:border-slate-700"
          >
            Change email
          </button>
        ) : null}

        {step.kind === "editing" ? (
          <form onSubmit={handleRequest} className="space-y-3" noValidate>
            <div className="space-y-2">
              <label
                htmlFor="account-new-email"
                className="text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                New email address
              </label>
              <input
                id="account-new-email"
                name="newEmail"
                type="email"
                autoComplete="email"
                maxLength={EMAIL_MAX_LENGTH}
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                aria-describedby={
                  emailError ? "account-new-email-error" : undefined
                }
                aria-invalid={emailError ? true : undefined}
                className={`h-12 w-full rounded-xl border bg-white dark:bg-slate-900 px-4 text-[15px] text-slate-900 dark:text-white outline-none transition ${
                  emailError
                    ? "border-rose-300 dark:border-rose-800 ring-4 ring-rose-100"
                    : "border-slate-200 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800"
                }`}
              />
              {emailError ? (
                <FieldErrorMessage
                  id="account-new-email-error"
                  message={emailError}
                  tone="error"
                />
              ) : null}
            </div>

            <p className="text-sm text-slate-500 dark:text-slate-400">
              We&rsquo;ll email a 6-digit code to the new address, and send a
              security notice to your current one. Nothing changes until you
              enter the code.
            </p>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={pending}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 dark:disabled:bg-slate-700"
              >
                {pending ? "Sending code..." : "Send verification code"}
              </button>
              <button
                type="button"
                onClick={returnToIdle}
                disabled={pending}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 px-5 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:border-slate-300 dark:hover:border-slate-700"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {step.kind === "confirming" ? (
          <form onSubmit={handleConfirm} className="space-y-3" noValidate>
            <div className="space-y-2">
              <label
                htmlFor="account-email-code"
                className="text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Verification code sent to {step.email}
              </label>
              <input
                id="account-email-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={CODE_LENGTH}
                value={code}
                onChange={(event) =>
                  setCode(
                    event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH),
                  )
                }
                aria-invalid={codeError ? true : undefined}
                className={`h-12 w-full rounded-xl border bg-white dark:bg-slate-900 px-4 text-[15px] tracking-[0.4em] text-slate-900 dark:text-white outline-none transition ${
                  codeError
                    ? "border-rose-300 dark:border-rose-800 ring-4 ring-rose-100"
                    : "border-slate-200 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800"
                }`}
              />
              {codeError ? (
                <FieldErrorMessage
                  id="account-email-code-error"
                  message={codeError}
                  tone="error"
                />
              ) : null}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={pending}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 dark:disabled:bg-slate-700"
              >
                {pending ? "Confirming..." : "Confirm new email"}
              </button>
              <button
                type="button"
                onClick={() => void handleResend()}
                disabled={pending || resendSeconds > 0}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 px-5 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:text-slate-400 dark:hover:border-slate-700"
              >
                {resendSeconds > 0
                  ? `Resend in ${resendSeconds}s`
                  : "Resend code"}
              </button>
              <button
                type="button"
                onClick={() => void handleCancel()}
                disabled={pending}
                className="inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold text-slate-500 dark:text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
              >
                Cancel change
              </button>
            </div>
          </form>
        ) : null}
      </div>

      {dialogOptions ? (
        <MfaVerificationDialog
          open
          initialOptions={dialogOptions}
          scope={MFA_SCOPE}
          onCancel={() => closeDialogWith(false)}
          onVerified={() => closeDialogWith(true)}
        />
      ) : null}
    </>
  );
}
