"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { RecoveryCodesDisplay } from "@/components/auth/recovery-codes-display";
import { useMfaStepUp } from "@/components/auth/use-mfa-step-up";
import { HomeMfaRecoveryCodesSection } from "@/components/home/home-mfa-recovery-codes-section";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  mfaRecoveryCodesApi,
  type MfaRecoveryCodeStatusResult,
} from "@/lib/auth/mfa-recovery-codes-api";
import { mfaVerificationApi } from "@/lib/auth/mfa-verification-api";

interface HomeMfaRecoveryCodesPanelProps {
  /** Changes when a passkey or the authenticator app was added or removed. */
  refreshKey?: number;
}

/**
 * Recovery codes, shown while the account has a strong factor (a passkey or
 * an authenticator app) for them to stand in for. Whether it has one comes
 * from the step-up options, which list exactly those factors.
 */
export function HomeMfaRecoveryCodesPanel({
  refreshKey = 0,
}: HomeMfaRecoveryCodesPanelProps) {
  const { status } = useAuth();
  const { runWithStepUp, stepUpDialog } = useMfaStepUp();
  const [recoveryStatus, setRecoveryStatus] =
    useState<MfaRecoveryCodeStatusResult | null>(null);
  const [hasStrongFactor, setHasStrongFactor] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    let active = true;

    Promise.all([
      mfaVerificationApi.getOptions("mfa-management"),
      mfaRecoveryCodesApi.getStatus(),
    ])
      .then(([options, nextStatus]) => {
        if (!active) return;
        setHasStrongFactor(
          options.availableFactors.some(
            (factor) => factor === "passkey" || factor === "totp",
          ),
        );
        setRecoveryStatus(nextStatus);
      })
      .catch(() => {
        // The factors' own panels still work without this one.
        if (active) setHasStrongFactor(false);
      });

    return () => {
      active = false;
    };
  }, [refreshKey, status]);

  async function handleRegenerate() {
    setPending(true);
    setMessage(null);

    try {
      const outcome = await runWithStepUp(() =>
        mfaRecoveryCodesApi.regenerate(),
      );

      if (!outcome.completed) {
        return;
      }

      setCodes(outcome.result.codes);
      setRecoveryStatus({
        remaining: outcome.result.remaining,
        createdAt: outcome.result.createdAt,
      });
    } catch (error) {
      setMessage(
        getApiErrorMessage(error, {
          action: "generate new recovery codes",
          fallback:
            "We couldn't generate new recovery codes right now. Please try again.",
          preserveClientMessage: true,
        }),
      );
    } finally {
      setPending(false);
    }
  }

  if (status !== "authenticated" || !hasStrongFactor || !recoveryStatus) {
    return null;
  }

  return (
    <section
      aria-labelledby="recovery-codes-heading"
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2
            id="recovery-codes-heading"
            className="text-2xl font-semibold text-slate-950 dark:text-white"
          >
            Recovery codes
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
            One-time codes that get you in if you lose your passkeys or
            authenticator app.
          </p>
        </div>
      </div>

      {message ? (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-300"
        >
          {message}
        </div>
      ) : null}

      {codes ? (
        <div className="mt-6">
          <RecoveryCodesDisplay codes={codes} onDone={() => setCodes(null)} />
        </div>
      ) : (
        <HomeMfaRecoveryCodesSection
          status={recoveryStatus}
          pending={pending}
          onRegenerate={() => void handleRegenerate()}
        />
      )}

      {stepUpDialog}
    </section>
  );
}
