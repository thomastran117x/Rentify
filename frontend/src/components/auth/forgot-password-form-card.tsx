import Link from "next/link";
import type { ReactNode } from "react";
import { theme } from "@/styles/theme";

interface ForgotPasswordFormCardProps {
  children: ReactNode;
}

export function ForgotPasswordFormCard({
  children,
}: ForgotPasswordFormCardProps) {
  return (
    <div className={theme.auth.card}>
      <div className="mb-8">
        <p className={theme.auth.cardEyebrow}>Password help</p>
        <h2 className={theme.auth.cardTitle}>Reset password</h2>
        <p className={theme.auth.cardDescription}>
          Request a reset code, choose a new password, and get back into your
          rental workspace.
        </p>
      </div>

      {children}

      <div className="mt-6 flex items-center gap-3">
        <div className={theme.auth.dividerLine} />
        <span className={theme.auth.dividerText}>Remembered it?</span>
        <div className={theme.auth.dividerLine} />
      </div>

      <Link href="/login" className={`mt-6 ${theme.auth.secondaryButton}`}>
        Back to sign in
      </Link>
    </div>
  );
}
