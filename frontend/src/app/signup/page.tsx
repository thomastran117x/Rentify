import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";
import { SignupFormCard } from "@/components/auth/signup-form-card";
import { AuthPageShell } from "@/components/auth/auth-page-shell";

export const metadata: Metadata = {
  title: "Sign Up | Rentify",
  description:
    "Create your Rentify account to manage rental listings, bookings, and guest conversations in one place.",
  openGraph: {
    title: "Sign Up | Rentify",
    description:
      "Create your Rentify account to manage rental listings, bookings, and guest conversations in one place.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Sign Up | Rentify",
    description:
      "Create your Rentify account to manage rental listings, bookings, and guest conversations in one place.",
  },
};

interface SignupPageProps {
  searchParams?: Promise<{
    next?: string;
  }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const nextPath = resolvedSearchParams?.next || "/";

  return (
    <AuthPageShell variant="signup">
      <SignupFormCard>
        <SignupForm nextPath={nextPath} />
      </SignupFormCard>
    </AuthPageShell>
  );
}
