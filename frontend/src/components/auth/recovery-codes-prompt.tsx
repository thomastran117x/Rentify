"use client";

import { useState } from "react";
import { RecoveryCodesDisplay } from "@/components/auth/recovery-codes-display";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { mfaRecoveryCodesApi } from "@/lib/auth/mfa-recovery-codes-api";
import { theme } from "@/styles/theme";

interface RecoveryCodesPromptProps {
  onDone: () => void;
}

/**
 * Stands between a sign-in that spent the account's last recovery code and the
 * app. The sign-in itself is what lets this replace the codes, and only for a
 * short while, so this is the moment: anyone who has lost their authenticator
 * has no other way to step up afterwards.
 */
export function RecoveryCodesPrompt({ onDone }: RecoveryCodesPromptProps) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setPending(true);
    setError(null);

    try {
      const result = await mfaRecoveryCodesApi.regenerate();
      setCodes(result.codes);
    } catch (generateError) {
      setError(
        getApiErrorMessage(generateError, {
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

  if (codes) {
    return <RecoveryCodesDisplay codes={codes} onDone={onDone} />;
  }

  return (
    <div className="space-y-5">
      <div className={theme.auth.warningPanel}>
        <p className="text-sm font-semibold">
          That was your last recovery code
        </p>
        <p className="mt-2 text-sm leading-6">
          You&apos;re signed in, but you have no codes left. If you&apos;ve lost
          your authenticator app, generate new codes now. Once you leave this
          page you won&apos;t be able to do it without the app.
        </p>
      </div>

      {error ? (
        <div role="alert" className={theme.auth.errorPanel}>
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void handleGenerate()}
        disabled={pending}
        className={theme.auth.primaryButton}
      >
        {pending ? "Generating..." : "Generate new codes"}
      </button>

      <button
        type="button"
        onClick={onDone}
        disabled={pending}
        className={theme.auth.tertiaryLink}
      >
        Skip for now
      </button>
    </div>
  );
}
