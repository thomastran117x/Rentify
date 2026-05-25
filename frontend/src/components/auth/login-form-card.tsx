import Link from "next/link";
import type { ReactNode } from "react";
import { theme } from "@/styles/theme";

interface LoginFormCardProps {
  children: ReactNode;
}

export function LoginFormCard({ children }: LoginFormCardProps) {
  return (
    <div className={theme.auth.card}>
      <div className="mb-8">
        <p className={theme.auth.cardEyebrow}>Account access</p>
        <h2 className={theme.auth.cardTitle}>Sign in</h2>
        <p className={theme.auth.cardDescription}>
          Access your bookings, listings, and messages from one polished
          workspace.
        </p>
      </div>

      {children}

      <div className="mt-6 flex items-center gap-3">
        <div className={theme.auth.dividerLine} />
        <span className={theme.auth.dividerText}>New here?</span>
        <div className={theme.auth.dividerLine} />
      </div>

      <Link href="/signup" className={`mt-6 ${theme.auth.secondaryButton}`}>
        Create an account
      </Link>

      <p className="mt-6 text-center text-xs leading-6 text-slate-500">
        Secure sign in for your rental workspace and booking management.
      </p>
    </div>
  );
}
