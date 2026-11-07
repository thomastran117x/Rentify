"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { authApi } from "@/lib/auth/api";
import { theme } from "@/styles/theme";

const RECOVERY_PATH = "/login?recovery=account";

/**
 * The way back in is the password reset on the sign-in page, which sends a
 * signed-in visitor home instead. When this browser is still signed in, to
 * an account other than the one just locked, the user signs out first.
 */
export function ResetPasswordAction({
  className = "",
  sessionEnded = false,
}: {
  className?: string;
  /** This browser's session belonged to the locked account and is being dropped. */
  sessionEnded?: boolean;
}) {
  const { status, session, clearSession } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);

    try {
      await authApi.logout();
    } catch {
      // The local sign-out below is what unblocks the reset page.
    } finally {
      clearSession();
      setSigningOut(false);
    }
  }

  if (sessionEnded || status !== "authenticated") {
    return (
      <Link
        href={RECOVERY_PATH}
        className={`${className} ${theme.auth.primaryButton}`}
      >
        Reset your password
      </Link>
    );
  }

  return (
    <div className={className}>
      <p className={`${theme.auth.infoPanel} text-sm leading-6`}>
        This browser is signed in as {session?.user.email ?? "another account"}.
        Sign out to reset the password of the account you locked.
      </p>
      <button
        type="button"
        onClick={() => void handleSignOut()}
        disabled={signingOut}
        className={`mt-3 ${theme.auth.primaryButton}`}
      >
        {signingOut ? "Signing out..." : "Sign out"}
      </button>
    </div>
  );
}
