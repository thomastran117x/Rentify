import Link from "next/link";
import type { ReactNode } from "react";
import { theme } from "@/styles/theme";

interface SignupFormCardProps {
  children: ReactNode;
}

export function SignupFormCard({ children }: SignupFormCardProps) {
  return (
    <div className={theme.auth.card}>
      <div className="mb-5 space-y-3">
        <div className={theme.auth.eyebrow}>Start in minutes</div>

        <div>
          <p className={theme.auth.cardEyebrow}>Create your account</p>
          <h2 className={theme.auth.cardTitle}>Sign up</h2>
        </div>
      </div>

      {children}

      <div className="mt-5 flex items-center gap-3">
        <div className={theme.auth.dividerLine} />
        <span className={theme.auth.dividerText}>Already registered?</span>
        <div className={theme.auth.dividerLine} />
      </div>

      <Link href="/login" className={`mt-5 ${theme.auth.secondaryButton}`}>
        Back to sign in
      </Link>
    </div>
  );
}
