"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { ResetPasswordAction } from "@/components/auth/reset-password-action";
import { FormErrorMessage } from "@/components/errors";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { isApiClientError } from "@/lib/api/types";
import { authApi } from "@/lib/auth/api";
import {
  emailChangeApi,
  type EmailChangeRevertNextStep,
} from "@/lib/auth/email-change-api";
import { theme } from "@/styles/theme";

type RevertOutcome = EmailChangeRevertNextStep | "expired";

interface EmailChangeRevertCardProps {
  token: string | null;
}

function ExpiredCard() {
  return (
    <div className={theme.auth.card}>
      <div className="mb-6">
        <p className={theme.auth.cardEyebrow}>Link unavailable</p>
        <h2 className={theme.auth.cardTitle}>This link has expired</h2>
        <p className={theme.auth.cardDescription}>
          This link has expired, was already used, or the email on the account
          has changed again, so nothing was changed. If you can&apos;t get back
          into your account, contact Rentify support.
        </p>
      </div>

      <Link href="/login" className={theme.auth.secondaryButton}>
        Back to sign in
      </Link>
    </div>
  );
}

function ResetRequiredCard() {
  return (
    <div className={theme.auth.card}>
      <div className="mb-6">
        <p className={theme.auth.cardEyebrow}>Email restored</p>
        <h2 className={theme.auth.cardTitle}>Your old email is back</h2>
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
            Once you are in, remove any devices and access tokens you don&apos;t
            recognise.
          </li>
        </ol>
      </div>

      <ResetPasswordAction className="mt-6" />
    </div>
  );
}

function SignInCard() {
  return (
    <div className={theme.auth.card}>
      <div className="mb-6">
        <p className={theme.auth.cardEyebrow}>Email restored</p>
        <h2 className={theme.auth.cardTitle}>Your old email is back</h2>
        <p className={theme.auth.cardDescription}>
          Everyone has been signed out. Sign in the way you usually do.
        </p>
      </div>

      <div className={theme.auth.successPanel} role="status">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Once you are in
        </p>
        <p className="mt-2 text-sm leading-6">
          Remove any sign-in methods, devices and access tokens you don&apos;t
          recognise.
        </p>
      </div>

      <Link href="/login" className={`mt-6 ${theme.auth.primaryButton}`}>
        Sign in
      </Link>
    </div>
  );
}

/**
 * The page behind the "put my old email back" link in an `email_changed`
 * email. Nothing happens until the user confirms: link scanners and
 * prefetchers open the page, but only the button posts the token.
 */
export function EmailChangeRevertCard({ token }: EmailChangeRevertCardProps) {
  const { status } = useAuth();
  const [outcome, setOutcome] = useState<RevertOutcome | null>(
    token ? null : "expired",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRevert() {
    if (!token) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      const { nextStep } = await emailChangeApi.revertWithToken(token);
      // If this browser was signed in to the account just reverted, its refresh
      // now fails and signs it out; another account's session survives.
      if (status === "authenticated") {
        await authApi.refresh().catch(() => null);
      }
      setOutcome(nextStep);
    } catch (nextError) {
      if (isApiClientError(nextError) && nextError.status === 410) {
        setOutcome("expired");
        return;
      }

      setError(
        getApiErrorMessage(nextError, {
          action: "put your old email back",
          fallback:
            "We couldn't put your old email back right now. Please try again.",
        }),
      );
    } finally {
      setPending(false);
    }
  }

  if (outcome === "expired") {
    return <ExpiredCard />;
  }

  if (outcome === "reset_password") {
    return <ResetRequiredCard />;
  }

  if (outcome === "sign_in") {
    return <SignInCard />;
  }

  return (
    <div className={theme.auth.card}>
      <div className="mb-6">
        <p className={theme.auth.cardEyebrow}>This wasn&apos;t me</p>
        <h2 className={theme.auth.cardTitle}>Put your old email back?</h2>
        <p className={theme.auth.cardDescription}>
          This moves your account back to the address this link was sent to, and
          signs everyone out, including you.
        </p>
      </div>

      <div
        className={`${theme.auth.warningPanel} flex items-start gap-3 text-sm leading-6`}
      >
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Only do this if you didn&apos;t change your email. If it was you,
          close this page; nothing has changed.
        </p>
      </div>

      <FormErrorMessage
        className="mt-5"
        title="Your email has not changed back"
        message={error}
      />

      <button
        type="button"
        onClick={() => void handleRevert()}
        disabled={pending}
        className={`mt-6 ${theme.auth.primaryButton}`}
      >
        {pending ? "Restoring..." : "Put my old email back"}
      </button>
      <Link href="/login" className={`mt-3 ${theme.auth.secondaryButton}`}>
        Cancel
      </Link>
    </div>
  );
}
