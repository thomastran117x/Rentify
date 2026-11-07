import type { Metadata } from "next";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { EmailChangeRevertCard } from "@/components/auth/email-change-revert-card";

export const metadata: Metadata = {
  title: "Put your old email back | Rentify",
  description:
    "Didn't change your email? Put your old address back on your Rentify account and sign everyone out.",
  robots: { index: false, follow: false },
};

interface EmailChangeRevertPageProps {
  searchParams?: Promise<{
    token?: string;
  }>;
}

/**
 * The target of the link in an `email_changed` email. Rendering it never
 * changes anything: the token is posted only when the user confirms.
 */
export default async function EmailChangeRevertPage({
  searchParams,
}: EmailChangeRevertPageProps) {
  const resolvedSearchParams = await searchParams;

  return (
    <AuthPageShell variant="email-change-revert">
      <EmailChangeRevertCard
        token={resolvedSearchParams?.token?.trim() || null}
      />
    </AuthPageShell>
  );
}
