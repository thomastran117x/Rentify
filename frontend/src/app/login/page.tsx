import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { LoginFormCard } from "@/components/auth/login-form-card";
import { AuthPageShell } from "@/components/auth/auth-page-shell";

export const metadata: Metadata = {
  title: "Login | Rentify",
  description:
    "Sign in to Rentify to manage your rental listings, bookings, and guest conversations in one place.",
  openGraph: {
    title: "Login | Rentify",
    description:
      "Sign in to Rentify to manage your rental listings, bookings, and guest conversations in one place.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Login | Rentify",
    description:
      "Sign in to Rentify to manage your rental listings, bookings, and guest conversations in one place.",
  },
};

interface LoginPageProps {
  searchParams?: Promise<{
    next?: string;
    recovery?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const nextPath = resolvedSearchParams?.next || "/";
  const initialRecoveryOpen = resolvedSearchParams?.recovery === "account";

  return (
    <AuthPageShell variant="login">
      <LoginFormCard>
        <LoginForm
          nextPath={nextPath}
          initialRecoveryOpen={initialRecoveryOpen}
        />
      </LoginFormCard>
    </AuthPageShell>
  );
}
