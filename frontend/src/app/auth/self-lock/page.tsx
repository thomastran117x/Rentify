import type { Metadata } from "next";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { SelfLockCard } from "@/components/auth/self-lock-card";

export const metadata: Metadata = {
  title: "Lock your account | Rentify",
  description:
    "Didn't sign in? Lock your Rentify account to sign everyone out until you reset your password.",
  robots: { index: false, follow: false },
};

interface SelfLockPageProps {
  searchParams?: Promise<{
    token?: string;
    status?: string;
  }>;
}

/**
 * The target of the "This wasn't you? Lock your account" email link. Rendering
 * it never locks anything: link scanners and prefetchers only issue GETs, and
 * the lock happens only when the user confirms.
 */
export default async function SelfLockPage({
  searchParams,
}: SelfLockPageProps) {
  const resolvedSearchParams = await searchParams;

  return (
    <AuthPageShell variant="self-lock">
      <SelfLockCard
        token={resolvedSearchParams?.token?.trim() || null}
        alreadyLocked={resolvedSearchParams?.status === "locked"}
      />
    </AuthPageShell>
  );
}
