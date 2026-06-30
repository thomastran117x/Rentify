"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Mail, MessageSquare, ShieldCheck, Smartphone, X } from "lucide-react";
import { ApiClientError, isApiClientError } from "@/lib/api/types";
import {
  type MfaVerificationChallengeFactor,
  type MfaVerificationConfirmResult,
  type MfaVerificationFactor,
  type MfaVerificationOptionsResult,
  type MfaVerificationScope,
  mfaVerificationApi,
} from "@/lib/auth/mfa-verification-api";
import { getApiErrorMessage } from "@/lib/api/user-messages";

interface MfaVerificationDialogProps {
  open: boolean;
  initialOptions: MfaVerificationOptionsResult;
  preferredFactor?: MfaVerificationFactor | null;
  scope: MfaVerificationScope;
  onCancel: () => void;
  onVerified: (result: MfaVerificationConfirmResult) => void;
}

const FACTOR_LABELS: Record<MfaVerificationChallengeFactor, string> = {
  email: "Email",
  sms: "SMS",
  totp: "Authenticator",
};

function FactorIcon({
  factor,
  className,
}: {
  factor: MfaVerificationChallengeFactor;
  className?: string;
}) {
  if (factor === "email")
    return <Mail className={className} aria-hidden="true" />;
  if (factor === "sms")
    return <MessageSquare className={className} aria-hidden="true" />;
  return <Smartphone className={className} aria-hidden="true" />;
}

function normalizeCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

function getFocusableElements(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

function isChallengeFactor(
  factor: MfaVerificationFactor | null | undefined,
): factor is MfaVerificationChallengeFactor {
  return factor === "email" || factor === "totp" || factor === "sms";
}

function selectInitialFactor(
  options: MfaVerificationOptionsResult,
  preferredFactor?: MfaVerificationFactor | null,
): MfaVerificationChallengeFactor | null {
  if (
    isChallengeFactor(preferredFactor) &&
    options.availableFactors.includes(preferredFactor)
  ) {
    return preferredFactor;
  }

  if (
    isChallengeFactor(options.recommendedFactor) &&
    options.availableFactors.includes(options.recommendedFactor)
  ) {
    return options.recommendedFactor;
  }

  const firstAvailable = options.availableFactors.find(isChallengeFactor);
  return firstAvailable ?? null;
}

export function MfaVerificationDialog({
  open,
  initialOptions,
  preferredFactor = null,
  scope,
  onCancel,
  onVerified,
}: MfaVerificationDialogProps) {
  const [options, setOptions] = useState(initialOptions);
  const [selectedFactor, setSelectedFactor] =
    useState<MfaVerificationChallengeFactor | null>(
      selectInitialFactor(initialOptions, preferredFactor),
    );
  const [code, setCode] = useState("");
  const [challengeSent, setChallengeSent] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loadingChallenge, setLoadingChallenge] = useState(false);
  const [loadingConfirm, setLoadingConfirm] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Reset state when dialog opens or options change
  useEffect(() => {
    if (!open) {
      setOptions(initialOptions);
      setSelectedFactor(selectInitialFactor(initialOptions, preferredFactor));
      setCode("");
      setChallengeSent(false);
      setCooldownUntil(null);
      setErrorMessage(null);
      return;
    }

    setOptions(initialOptions);
    setSelectedFactor(selectInitialFactor(initialOptions, preferredFactor));
  }, [initialOptions, open, preferredFactor]);

  // Focus management
  useEffect(() => {
    if (!open || !dialogRef.current) {
      if (!open && restoreFocusRef.current) {
        restoreFocusRef.current.focus();
        restoreFocusRef.current = null;
      }
      return;
    }

    if (
      !restoreFocusRef.current &&
      document.activeElement instanceof HTMLElement
    ) {
      restoreFocusRef.current = document.activeElement;
    }

    const [firstFocusable] = getFocusableElements(dialogRef.current);
    (firstFocusable ?? dialogRef.current).focus();
  }, [open]);

  // Auto-focus code input after challenge is sent
  useEffect(() => {
    if (challengeSent && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [challengeSent]);

  // Trap focus inside dialog
  useEffect(() => {
    if (!open || !dialogRef.current) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!dialogRef.current) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements(dialogRef.current);

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusableElements[0]!;
      const last = focusableElements[focusableElements.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open]);

  // Cooldown countdown
  useEffect(() => {
    if (!open || !cooldownUntil) {
      return;
    }

    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [cooldownUntil, open]);

  const challengeFactors = options.availableFactors.filter(isChallengeFactor);
  const unavailable = challengeFactors.length === 0 || !selectedFactor;
  const cooldownActive =
    cooldownUntil !== null && new Date(cooldownUntil).getTime() > nowMs;
  const cooldownSeconds = cooldownUntil
    ? Math.max(0, Math.ceil((new Date(cooldownUntil).getTime() - nowMs) / 1000))
    : 0;

  // For email/SMS: two-step. For TOTP: show code immediately.
  const needsChallenge = selectedFactor === "email" || selectedFactor === "sms";
  const showCodeInput = !needsChallenge || challengeSent;

  async function refreshOptions(
    nextPreferredFactor: MfaVerificationFactor | null = selectedFactor,
  ) {
    const refreshed = await mfaVerificationApi.getOptions(scope);
    setOptions(refreshed);
    setSelectedFactor(selectInitialFactor(refreshed, nextPreferredFactor));
    setChallengeSent(false);
    setCooldownUntil(null);
    return refreshed;
  }

  function readDialogError(error: unknown, action: string): string {
    if (isApiClientError(error)) {
      return error.message;
    }

    return getApiErrorMessage(error, {
      action,
      fallback:
        "We couldn't complete MFA verification right now. Please try again.",
      preserveClientMessage: true,
    });
  }

  async function handleChallenge() {
    if (!selectedFactor) {
      return;
    }

    setLoadingChallenge(true);
    setErrorMessage(null);

    try {
      const result = await mfaVerificationApi.issueChallenge(
        scope,
        selectedFactor,
      );
      if (result.factor === "email" || result.factor === "sms") {
        setChallengeSent(true);
        setCooldownUntil(result.cooldownUntil);
      }
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "MFA_FACTOR_UNAVAILABLE"
      ) {
        await refreshOptions(selectedFactor);
      }
      setErrorMessage(readDialogError(error, "send your verification code"));
    } finally {
      setLoadingChallenge(false);
    }
  }

  async function handleConfirm() {
    if (!selectedFactor) {
      return;
    }

    if (code.length !== 6) {
      setErrorMessage("Enter the 6-digit verification code to continue.");
      return;
    }

    setLoadingConfirm(true);
    setErrorMessage(null);

    try {
      const result = await mfaVerificationApi.confirmChallenge(
        scope,
        selectedFactor,
        code,
      );
      onVerified(result);
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "MFA_FACTOR_UNAVAILABLE"
      ) {
        await refreshOptions(selectedFactor);
      }
      setErrorMessage(readDialogError(error, "verify your code"));
    } finally {
      setLoadingConfirm(false);
    }
  }

  function handleFactorSelect(factor: MfaVerificationChallengeFactor) {
    setSelectedFactor(factor);
    setErrorMessage(null);
    setCode("");
    setChallengeSent(false);
    setCooldownUntil(null);
  }

  function handleCodeChange(event: React.ChangeEvent<HTMLInputElement>) {
    setCode(normalizeCode(event.target.value));
  }

  function handleCodePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    setCode(normalizeCode(event.clipboardData.getData("text")));
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 px-4 py-8">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.28)] outline-none"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50"
            aria-label="Close verification dialog"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <h2 id={titleId} className="mt-4 text-xl font-semibold text-slate-950">
          Verify it&apos;s you
        </h2>
        <p
          id={descriptionId}
          className="mt-1.5 text-sm leading-6 text-slate-500"
        >
          Recent verification is required to continue.
        </p>

        {/* Factor switcher — only when multiple factors */}
        {!unavailable && challengeFactors.length > 1 && (
          <div className="mt-5 flex gap-1.5 rounded-xl border border-slate-200 bg-slate-100 p-1">
            {challengeFactors.map((factor) => {
              const active = factor === selectedFactor;
              return (
                <button
                  key={factor}
                  type="button"
                  onClick={() => handleFactorSelect(factor)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    active
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <FactorIcon factor={factor} className="h-3.5 w-3.5" />
                  {FACTOR_LABELS[factor]}
                </button>
              );
            })}
          </div>
        )}

        {/* Error banner */}
        {errorMessage ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        {/* No factors available */}
        {unavailable ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            No verification methods are available for this account. Please
            contact support or recover access before changing security settings.
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {/* Email / SMS: two-step */}
            {needsChallenge && !showCodeInput && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  {selectedFactor === "email"
                    ? "We'll send a 6-digit code to your verified email address."
                    : "We'll send a 6-digit code to your registered phone number."}
                </p>
                <button
                  type="button"
                  onClick={() => void handleChallenge()}
                  disabled={loadingChallenge}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FactorIcon
                    factor={selectedFactor}
                    className="h-4 w-4 opacity-70"
                  />
                  {loadingChallenge
                    ? "Sending..."
                    : `Send code via ${selectedFactor === "email" ? "email" : "SMS"}`}
                </button>
              </div>
            )}

            {/* Code input step (email/SMS after send, or TOTP immediately) */}
            {showCodeInput && (
              <div className="space-y-4">
                {!needsChallenge && (
                  <p className="text-sm text-slate-600">
                    Enter the current 6-digit code from your authenticator app.
                  </p>
                )}
                {needsChallenge && (
                  <p className="text-sm text-slate-600">
                    Check your {selectedFactor === "email" ? "email" : "phone"}{" "}
                    for a 6-digit code and enter it below.
                  </p>
                )}
                <input
                  ref={codeInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={handleCodeChange}
                  onPaste={handleCodePaste}
                  placeholder="000000"
                  className={`h-14 w-full rounded-2xl border bg-white px-4 text-center font-mono text-xl tracking-[0.35em] text-slate-900 outline-none transition ${
                    code.length === 6
                      ? "border-amber-300 ring-4 ring-amber-100"
                      : "border-slate-200 hover:border-amber-200 focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={loadingConfirm || code.length !== 6}
                  className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingConfirm ? "Verifying..." : "Verify"}
                </button>

                {/* Resend link for email/SMS */}
                {needsChallenge && (
                  <p className="text-center text-xs text-slate-500">
                    Didn&apos;t receive it?{" "}
                    <button
                      type="button"
                      onClick={() => void handleChallenge()}
                      disabled={loadingChallenge || cooldownActive}
                      className="font-medium text-slate-700 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loadingChallenge
                        ? "Sending..."
                        : cooldownActive
                          ? `Resend in ${cooldownSeconds}s`
                          : "Resend code"}
                    </button>
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Cancel link — always visible at bottom */}
        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={onCancel}
            disabled={loadingChallenge || loadingConfirm}
            className="text-xs text-slate-400 transition hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
