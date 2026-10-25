"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { FormErrorMessage } from "@/components/errors";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { isApiClientError } from "@/lib/api/types";
import { selfLockApi } from "@/lib/auth/self-lock-api";
import { theme } from "@/styles/theme";

const RECOVERY_PATH = "/login?recovery=account";

type SelfLockView = "confirm" | "locked" | "expired";

interface SelfLockCardProps {
  token: string | null;
  /** Set after the signed-in variant locked the account and came here. */
  alreadyLocked?: boolean;
}

function initialView(token: string | null, alreadyLocked: boolean) {
  if (alreadyLocked) {
    return "locked";
  }

  return token ? "confirm" : "expired";
}

export function SelfLockCard({
  token,
  alreadyLocked = false,
}: SelfLockCardProps) {
  const { clearSession } = useAuth();
  const [view, setView] = useState<SelfLockView>(() =>
    initialView(token, alreadyLocked),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The signed-in variant ended this browser's own session, so drop it. An
  // emailed link may be opened in a browser signed in to another account,
  // which the lock does not touch; a session of the locked account fails its
  // next refresh and signs out on its own.
  useEffect(() => {
    if (alreadyLocked) {
      clearSession();
    }
  }, [alreadyLocked, clearSession]);

  async function handleLock() {
    if (!token) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      await selfLockApi.lockWithToken(token);
      setView("locked");
    } catch (nextError) {
      if (isApiClientError(nextError) && nextError.status === 410) {
        setView("expired");
        return;
      }

      setError(
        getApiErrorMessage(nextError, {
          action: "lock your account",
          fallback:
            "We couldn't lock your account right now. Please try again.",
        }),
      );
    } finally {
      setPending(false);
    }
  }

  if (view === "locked") {
    return (
      <div className={theme.auth.card}>
        <div className="mb-6">
          <p className={theme.auth.cardEyebrow}>Account locked</p>
          <h2 className={theme.auth.cardTitle}>Your account is locked</h2>
          <p className={theme.auth.cardDescription}>
            Everyone has been signed out, and nobody can sign in until the
            password is reset. We sent you an email with these steps too.
          </p>
        </div>

        <div className={theme.auth.successPanel} role="status">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            To get back in
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6">
            <li>Reset your password with the code we email you.</li>
            <li>Choose a password you have not used before.</li>
            <li>
              Once you are in, remove any devices and access tokens you
              don&apos;t recognise.
            </li>
          </ol>
        </div>

        <Link
          href={RECOVERY_PATH}
          className={`mt-6 ${theme.auth.primaryButton}`}
        >
          Reset your password
        </Link>
      </div>
    );
  }

  if (view === "expired") {
    return (
      <div className={theme.auth.card}>
        <div className="mb-6">
          <p className={theme.auth.cardEyebrow}>Link unavailable</p>
          <h2 className={theme.auth.cardTitle}>This link has expired</h2>
          <p className={theme.auth.cardDescription}>
            This link has expired or was already used, so nothing was changed.
            If you still don&apos;t recognise a sign-in, reset your password
            now: that signs everyone else out.
          </p>
        </div>

        <Link href={RECOVERY_PATH} className={theme.auth.primaryButton}>
          Reset your password
        </Link>
        <Link href="/login" className={`mt-3 ${theme.auth.secondaryButton}`}>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className={theme.auth.card}>
      <div className="mb-6">
        <p className={theme.auth.cardEyebrow}>This wasn&apos;t me</p>
        <h2 className={theme.auth.cardTitle}>Lock your account?</h2>
        <p className={theme.auth.cardDescription}>
          If you didn&apos;t sign in, lock your account. Everyone using it,
          including you, is signed out straight away, and nobody can sign in
          until you reset your password.
        </p>
      </div>

      <div
        className={`${theme.auth.warningPanel} flex items-start gap-3 text-sm leading-6`}
      >
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Only lock your account if you don&apos;t recognise the sign-in. If it
          was you, close this page; nothing has changed.
        </p>
      </div>

      <FormErrorMessage
        className="mt-5"
        title="Your account is not locked"
        message={error}
      />

      <button
        type="button"
        onClick={() => void handleLock()}
        disabled={pending}
        className={`mt-6 ${theme.auth.primaryButton}`}
      >
        {pending ? "Locking..." : "Lock my account"}
      </button>
      <Link href="/login" className={`mt-3 ${theme.auth.secondaryButton}`}>
        Cancel
      </Link>
    </div>
  );
}
