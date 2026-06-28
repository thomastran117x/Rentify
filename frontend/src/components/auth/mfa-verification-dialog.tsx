"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ShieldCheck, Mail, Smartphone, X } from "lucide-react";
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
  return factor === "email" || factor === "totp";
}

function selectInitialFactor(
  options: MfaVerificationOptionsResult,
  preferredFactor?: MfaVerificationFactor | null,
): MfaVerificationChallengeFactor | null {
  if (isChallengeFactor(preferredFactor) && options.availableFactors.includes(preferredFactor)) {
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
  const [selectedFactor, setSelectedFactor] = useState<MfaVerificationChallengeFactor | null>(
    selectInitialFactor(initialOptions, preferredFactor),
  );
  const [emailCode, setEmailCode] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [challengeSent, setChallengeSent] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loadingChallenge, setLoadingChallenge] = useState(false);
  const [loadingConfirm, setLoadingConfirm] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
      setOptions(initialOptions);
      setSelectedFactor(selectInitialFactor(initialOptions, preferredFactor));
      setEmailCode("");
      setTotpCode("");
      setChallengeSent(false);
      setCooldownUntil(null);
      setErrorMessage(null);
      setInfoMessage(null);
      return;
    }

    setOptions(initialOptions);
    setSelectedFactor(selectInitialFactor(initialOptions, preferredFactor));
  }, [initialOptions, open, preferredFactor]);

  useEffect(() => {
    if (!open || !dialogRef.current) {
      if (!open && restoreFocusRef.current) {
        restoreFocusRef.current.focus();
        restoreFocusRef.current = null;
      }
      return;
    }

    if (!restoreFocusRef.current && document.activeElement instanceof HTMLElement) {
      restoreFocusRef.current = document.activeElement;
    }

    const [firstFocusable] = getFocusableElements(dialogRef.current);
    (firstFocusable ?? dialogRef.current).focus();
  }, [open]);

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

  useEffect(() => {
    if (!open || !cooldownUntil) {
      return;
    }

    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [cooldownUntil, open]);

  const unavailable = options.availableFactors.length === 0 || !selectedFactor;
  const cooldownActive =
    cooldownUntil !== null && new Date(cooldownUntil).getTime() > nowMs;

  async function refreshOptions(nextPreferredFactor: MfaVerificationFactor | null = selectedFactor) {
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
      fallback: "We couldn't complete MFA verification right now. Please try again.",
      preserveClientMessage: true,
    });
  }

  async function handleChallenge() {
    if (!selectedFactor) {
      return;
    }

    setLoadingChallenge(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const result = await mfaVerificationApi.issueChallenge(scope, selectedFactor);
      if (result.factor === "email") {
        setChallengeSent(true);
        setCooldownUntil(result.cooldownUntil);
        setInfoMessage("Verification code sent to your email.");
      } else {
        setInfoMessage("Enter the current 6-digit code from your authenticator app.");
      }
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "MFA_FACTOR_UNAVAILABLE") {
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

    const code = selectedFactor === "email" ? emailCode : totpCode;

    if (code.length !== 6) {
      setErrorMessage("Enter the 6-digit verification code to continue.");
      return;
    }

    setLoadingConfirm(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const result = await mfaVerificationApi.confirmChallenge(
        scope,
        selectedFactor,
        code,
      );
      onVerified(result);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "MFA_FACTOR_UNAVAILABLE") {
        await refreshOptions(selectedFactor);
      }
      setErrorMessage(readDialogError(error, "verify your code"));
    } finally {
      setLoadingConfirm(false);
    }
  }

  function handleFactorSelect(factor: MfaVerificationFactor) {
    if (!isChallengeFactor(factor)) {
      return;
    }

    setSelectedFactor(factor);
    setErrorMessage(null);
    setInfoMessage(null);
    setChallengeSent(false);
    setCooldownUntil(null);
  }

  function handleCodePaste(
    event: React.ClipboardEvent<HTMLInputElement>,
    type: "email" | "totp",
  ) {
    event.preventDefault();
    const pasted = normalizeCode(event.clipboardData.getData("text"));
    if (type === "email") {
      setEmailCode(pasted);
    } else {
      setTotpCode(pasted);
    }
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
        className="w-full max-w-lg rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.28)] outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <ShieldCheck className="h-6 w-6" aria-hidden="true" />
            </div>
            <h2 id={titleId} className="mt-4 text-2xl font-semibold text-slate-950">
              Verify it&apos;s you
            </h2>
            <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-600">
              Recent MFA verification is required before we can change your account security settings.
            </p>
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

        {errorMessage ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        {infoMessage ? (
          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {infoMessage}
          </div>
        ) : null}

        {unavailable ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            No verification methods are available for this account. Please contact support or recover access before changing MFA settings.
          </div>
        ) : (
          <>
            <div className="mt-6 flex gap-3">
              {options.availableFactors.filter(isChallengeFactor).map((factor) => {
                const active = factor === selectedFactor;
                return (
                  <button
                    key={factor}
                    type="button"
                    onClick={() => handleFactorSelect(factor)}
                    className={`inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                      active
                        ? "border-slate-950 bg-slate-950 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    {factor === "email" ? <Mail className="h-4 w-4" aria-hidden="true" /> : <Smartphone className="h-4 w-4" aria-hidden="true" />}
                    {factor === "email" ? "Email code" : "Authenticator code"}
                  </button>
                );
              })}
            </div>

            {selectedFactor === "email" ? (
              <div className="mt-6 space-y-4">
                <p className="text-sm text-slate-700">
                  Send a 6-digit code to your verified email address, then enter it below.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={emailCode}
                  onChange={(event) => setEmailCode(normalizeCode(event.target.value))}
                  onPaste={(event) => handleCodePaste(event, "email")}
                  placeholder="000000"
                  className={`h-14 w-full rounded-2xl border bg-white px-4 text-center font-mono text-xl tracking-[0.35em] text-slate-900 outline-none transition ${
                    emailCode.length === 6
                      ? "border-amber-300 ring-4 ring-amber-100"
                      : "border-slate-200 hover:border-amber-200"
                  }`}
                />
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void handleChallenge()}
                    disabled={loadingChallenge || cooldownActive}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingChallenge
                      ? "Sending..."
                      : challengeSent
                        ? "Resend code"
                        : "Send code"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirm()}
                    disabled={loadingConfirm || emailCode.length !== 6}
                    className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loadingConfirm ? "Verifying..." : "Verify"}
                  </button>
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={loadingChallenge || loadingConfirm}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                <p className="text-sm text-slate-700">
                  Enter the current 6-digit code from your authenticator app.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totpCode}
                  onChange={(event) => setTotpCode(normalizeCode(event.target.value))}
                  onPaste={(event) => handleCodePaste(event, "totp")}
                  placeholder="000000"
                  className={`h-14 w-full rounded-2xl border bg-white px-4 text-center font-mono text-xl tracking-[0.35em] text-slate-900 outline-none transition ${
                    totpCode.length === 6
                      ? "border-amber-300 ring-4 ring-amber-100"
                      : "border-slate-200 hover:border-amber-200"
                  }`}
                />
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void handleConfirm()}
                    disabled={loadingConfirm || totpCode.length !== 6}
                    className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loadingConfirm ? "Verifying..." : "Verify"}
                  </button>
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={loadingConfirm}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

