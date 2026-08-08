"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ScanLine } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { MfaVerificationDialog } from "@/components/auth/mfa-verification-dialog";
import { isApiClientError } from "@/lib/api/types";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  type MfaVerificationFactor,
  type MfaVerificationOptionsResult,
  type MfaVerificationScope,
  mfaVerificationApi,
} from "@/lib/auth/mfa-verification-api";
import { mfaTotpApi, type MfaTotpBeginResult } from "@/lib/auth/mfa-totp-api";

type View = "loading" | "idle" | "setup";

interface VerificationDialogState {
  options: MfaVerificationOptionsResult;
  preferredFactor?: MfaVerificationFactor | null;
}

const MFA_SCOPE: MfaVerificationScope = "mfa-management";

export function formatSecret(secret: string) {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

export function HomeMfaTotpPanel() {
  const { status, session } = useAuth();
  const [view, setView] = useState<View>("loading");
  const [enabled, setEnabled] = useState(false);
  const [enrollment, setEnrollment] = useState<MfaTotpBeginResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogState, setDialogState] =
    useState<VerificationDialogState | null>(null);
  const enrollCodeRef = useRef<HTMLInputElement>(null);
  const verificationResolverRef = useRef<((value: boolean) => void) | null>(
    null,
  );

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    let active = true;

    mfaTotpApi
      .getStatus()
      .then((result) => {
        if (!active) return;
        setEnabled(result.enabled);
        setView("idle");
      })
      .catch((error) => {
        if (!active) return;
        setMessage(
          getApiErrorMessage(error, {
            action: "load your MFA status",
            fallback:
              "We couldn't load your MFA status right now. Please refresh the page.",
          }),
        );
        setView("idle");
      });

    return () => {
      active = false;
    };
  }, [status]);

  useEffect(() => {
    if (!enrollment?.uri) {
      setQrDataUrl(null);
      return;
    }

    import("qrcode")
      .then((QRCode) => {
        QRCode.toDataURL(enrollment.uri, { width: 200, margin: 1 })
          .then(setQrDataUrl)
          .catch(() => setQrDataUrl(null));
      })
      .catch(() => setQrDataUrl(null));
  }, [enrollment?.uri]);

  useEffect(() => {
    if (view === "setup") {
      enrollCodeRef.current?.focus();
    }
  }, [view]);

  useEffect(() => {
    return () => {
      verificationResolverRef.current?.(false);
      verificationResolverRef.current = null;
    };
  }, []);

  async function ensureMfaProof(
    preferredFactor?: MfaVerificationFactor | null,
    initialOptions?: MfaVerificationOptionsResult,
  ) {
    try {
      const options =
        initialOptions ?? (await mfaVerificationApi.getOptions(MFA_SCOPE));

      if (options.verified) {
        return true;
      }

      if (options.availableFactors.length === 0) {
        setMessage(
          "We couldn't verify your identity because no MFA verification methods are available for this account. Please contact support before changing MFA settings.",
        );
        return false;
      }

      return await new Promise<boolean>((resolve) => {
        verificationResolverRef.current = resolve;
        setDialogState({
          options,
          preferredFactor,
        });
      });
    } catch (error) {
      setMessage(
        getApiErrorMessage(error, {
          action: "start MFA verification",
          fallback:
            "We couldn't start MFA verification right now. Please try again.",
          preserveClientMessage: true,
        }),
      );
      return false;
    }
  }

  function closeDialogWith(result: boolean) {
    setDialogState(null);
    verificationResolverRef.current?.(result);
    verificationResolverRef.current = null;
  }

  async function runProtectedAction<T>(
    action: () => Promise<T>,
    preferredFactor?: MfaVerificationFactor | null,
  ): Promise<T | null> {
    try {
      return await action();
    } catch (error) {
      if (
        !isApiClientError(error) ||
        error.code !== "MFA_VERIFICATION_REQUIRED"
      ) {
        throw error;
      }

      const details = error.details as
        | Pick<
            MfaVerificationOptionsResult,
            "scope" | "availableFactors" | "recommendedFactor" | "verifiedUntil"
          >
        | undefined;
      const initialOptions: MfaVerificationOptionsResult | undefined = details
        ? { ...details, verified: false }
        : undefined;

      const verified = await ensureMfaProof(preferredFactor, initialOptions);

      if (!verified) {
        return null;
      }

      return action();
    }
  }

  async function handleBeginEnrollment() {
    setPending(true);
    setMessage(null);

    try {
      const result = await runProtectedAction(
        () => mfaTotpApi.beginEnrollment(session?.user.email),
        enabled ? "totp" : null,
      );

      if (!result) {
        return;
      }

      setEnrollment(result);
      setEnrollCode("");
      setView("setup");
    } catch (error) {
      setMessage(
        getApiErrorMessage(error, {
          action: "set up your authenticator app",
          fallback: "We couldn't start MFA setup right now. Please try again.",
          preserveClientMessage: true,
        }),
      );
    } finally {
      setPending(false);
    }
  }

  async function handleConfirmEnrollment() {
    if (!enrollCode.trim()) {
      setMessage("Please enter the 6-digit code from your authenticator app.");
      return;
    }

    setPending(true);
    setMessage(null);

    try {
      const result = await runProtectedAction(
        () => mfaTotpApi.confirmEnrollment(enrollCode.trim()),
        enabled ? "totp" : null,
      );

      if (!result) {
        return;
      }

      setEnabled(true);
      setEnrollment(null);
      setQrDataUrl(null);
      setEnrollCode("");
      setView("idle");
      setMessage(
        "Authenticator app enabled. Your account is now protected with MFA.",
      );
    } catch (error) {
      setMessage(
        getApiErrorMessage(error, {
          action: "verify your code",
          fallback: "We couldn't verify that code. Please try again.",
          preserveClientMessage: true,
        }),
      );
    } finally {
      setPending(false);
    }
  }

  async function handleCancelEnrollment() {
    setPending(true);
    setMessage(null);

    try {
      await runProtectedAction(
        () => mfaTotpApi.cancelEnrollment(),
        enabled ? "totp" : null,
      );
    } catch {
      // Best-effort cleanup; the pending record expires on its own after 15 min.
    } finally {
      setEnrollment(null);
      setQrDataUrl(null);
      setEnrollCode("");
      setView("idle");
      setPending(false);
    }
  }

  async function handleDisable() {
    setPending(true);
    setMessage(null);

    try {
      const result = await runProtectedAction(
        () => mfaTotpApi.disable(),
        "totp",
      );

      if (!result) {
        return;
      }

      setEnabled(false);
      setMessage("Authenticator app disabled.");
    } catch (error) {
      setMessage(
        getApiErrorMessage(error, {
          action: "disable your authenticator app",
          fallback:
            "We couldn't disable your authenticator app right now. Please try again.",
          preserveClientMessage: true,
        }),
      );
    } finally {
      setPending(false);
    }
  }

  if (status !== "authenticated") {
    return null;
  }

  return (
    <>
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300">
            <ScanLine className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Authenticator app
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Use Google Authenticator, Microsoft Authenticator, or any
              TOTP-compatible app to generate login codes.
            </p>
          </div>
        </div>

        {message ? (
          <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
            {message}
          </div>
        ) : null}

        {view === "loading" ? (
          <div className="mt-6 text-sm text-slate-500 dark:text-slate-400">
            Loading...
          </div>
        ) : view === "idle" ? (
          <div className="mt-6">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-950 dark:text-white">
                  {enabled ? "Enabled" : "Not enabled"}
                </p>
                {enabled ? (
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Your account is protected with an authenticator app.
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Add an extra layer of security to your account.
                  </p>
                )}
              </div>
              {enabled ? (
                <button
                  type="button"
                  onClick={() => void handleDisable()}
                  disabled={pending}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? "Disabling..." : "Disable"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleBeginEnrollment()}
                  disabled={pending}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                >
                  {pending ? "Setting up..." : "Set up"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                1. Scan this QR code with your authenticator app
              </p>
              <div className="mt-3 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                {qrDataUrl ? (
                  <Image
                    src={qrDataUrl}
                    alt="TOTP QR code"
                    width={160}
                    height={160}
                    unoptimized
                    className="rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900"
                  />
                ) : (
                  <div className="flex h-[160px] w-[160px] items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-xs text-slate-500 dark:text-slate-400">
                    Generating...
                  </div>
                )}
                <div className="space-y-2">
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Or enter this key manually:
                  </p>
                  <code className="block rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2 font-mono text-sm tracking-wider text-slate-900 dark:text-white">
                    {enrollment ? formatSecret(enrollment.secret) : ""}
                  </code>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="totp-enroll-code"
                className="text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                2. Enter the 6-digit code shown in your app
              </label>
              <input
                id="totp-enroll-code"
                ref={enrollCodeRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={enrollCode}
                onChange={(event) =>
                  setEnrollCode(
                    event.target.value.replace(/\D/g, "").slice(0, 6),
                  )
                }
                placeholder="000000"
                className={`h-14 w-full max-w-xs rounded-2xl border bg-white dark:bg-slate-900 px-4 text-center font-mono text-xl tracking-[0.4em] text-slate-900 dark:text-white outline-none transition ${
                  enrollCode.length === 6
                    ? "border-violet-300 ring-4 ring-violet-100"
                    : "border-slate-200 dark:border-slate-800 hover:border-violet-200 dark:hover:border-violet-800"
                }`}
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void handleConfirmEnrollment()}
                disabled={pending || enrollCode.length !== 6}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
              >
                {pending ? "Verifying..." : "Verify and enable"}
              </button>
              <button
                type="button"
                onClick={() => void handleCancelEnrollment()}
                disabled={pending}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 px-5 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {dialogState ? (
        <MfaVerificationDialog
          open
          initialOptions={dialogState.options}
          preferredFactor={dialogState.preferredFactor}
          scope={MFA_SCOPE}
          onCancel={() => closeDialogWith(false)}
          onVerified={() => closeDialogWith(true)}
        />
      ) : null}
    </>
  );
}
