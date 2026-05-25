import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  House,
  KeyRound,
  LayoutDashboard,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { theme } from "@/styles/theme";

type AuthPageVariant = "login" | "signup" | "forgot-password";

interface AuthPageShellProps {
  children: ReactNode;
  variant: AuthPageVariant;
}

interface AuthFeature {
  icon: typeof Sparkles;
  title: string;
  description: string;
}

interface AuthShellConfig {
  eyebrow: string;
  title: string;
  description: string;
  features: AuthFeature[];
  spotlightLabel: string;
  spotlightTitle: string;
  spotlightDescription: string;
  spotlightItems: string[];
}

const authShellContent: Record<AuthPageVariant, AuthShellConfig> = {
  login: {
    eyebrow: "Welcome back",
    title: "Sign in and get back to your rental flow without the clutter.",
    description:
      "Auth should feel like part of Rentify, not a separate product. This keeps account access aligned with the clean marketplace and dashboard experience across the rest of the site.",
    features: [
      {
        icon: LayoutDashboard,
        title: "Fast dashboard access",
        description:
          "Jump straight into bookings, listings, and account activity.",
      },
      {
        icon: ShieldCheck,
        title: "Protected sign-in",
        description:
          "Verification and recovery steps stay visible when you need them.",
      },
      {
        icon: Sparkles,
        title: "Shared visual language",
        description:
          "The same surfaces, spacing, and accent color as the home experience.",
      },
    ],
    spotlightLabel: "What you can do next",
    spotlightTitle: "Stay oriented from the first click.",
    spotlightDescription:
      "Whether you are browsing rentals or managing them, the sign-in screen should feel connected to the same product rhythm you just came from.",
    spotlightItems: [
      "Browse listings from the public marketplace.",
      "Return to active bookings and conversations.",
      "Move into posting management without a visual context switch.",
    ],
  },
  signup: {
    eyebrow: "Create your workspace",
    title:
      "Start a Rentify account that feels connected to the rest of the platform.",
    description:
      "The sign-up flow now leans on the same tone as the homepage and header so account creation feels like the next step in the product, not a detour into a different UI.",
    features: [
      {
        icon: Sparkles,
        title: "Cleaner onboarding",
        description:
          "Create an account in a calmer layout with clearer sections.",
      },
      {
        icon: Mail,
        title: "Built-in verification",
        description: "Email confirmation stays close to the main account flow.",
      },
      {
        icon: House,
        title: "Ready for renting",
        description:
          "Continue into search, bookings, or listing creation with less friction.",
      },
    ],
    spotlightLabel: "Why this flow feels familiar",
    spotlightTitle: "One theme across discovery and account setup.",
    spotlightDescription:
      "The same violet accents, white surfaces, and roomy spacing from the public site carry through account creation so new users always know they are still in Rentify.",
    spotlightItems: [
      "Profile and credentials are grouped into clearer sections.",
      "Support states stay visible without overwhelming the page.",
      "Calls to action match the rest of the website.",
    ],
  },
  "forgot-password": {
    eyebrow: "Recover access",
    title: "Reset your password in a flow that still feels like home.",
    description:
      "Recovery screens should be reassuring, simple, and consistent with the marketplace and account areas users already know.",
    features: [
      {
        icon: KeyRound,
        title: "Guided recovery",
        description:
          "Request a code, reset your password, and continue without guesswork.",
      },
      {
        icon: ShieldCheck,
        title: "Secure by default",
        description:
          "Verification steps stay explicit while keeping the page approachable.",
      },
      {
        icon: LayoutDashboard,
        title: "Back to work quickly",
        description:
          "Recover access and return to your listings or bookings with less friction.",
      },
    ],
    spotlightLabel: "A steadier fallback",
    spotlightTitle: "Supportive when something goes wrong.",
    spotlightDescription:
      "Password recovery is part of the core experience too, so it uses the same surfaces, spacing, and action styles as the rest of Rentify.",
    spotlightItems: [
      "Request and resend actions are clearly separated.",
      "Code entry stays readable on mobile and desktop.",
      "Users can return to sign in without losing their place.",
    ],
  },
};

export function AuthPageShell({ children, variant }: AuthPageShellProps) {
  const content = authShellContent[variant];

  return (
    <main className={theme.auth.page}>
      <div className={theme.auth.background} aria-hidden="true" />
      <div className={theme.auth.orbPrimary} aria-hidden="true" />
      <div className={theme.auth.orbSecondary} aria-hidden="true" />
      <div className={theme.auth.orbAccent} aria-hidden="true" />

      <div className={theme.auth.container}>
        <section className={theme.auth.heroColumn}>
          <p className={theme.auth.eyebrow}>{content.eyebrow}</p>
          <h1 className={theme.auth.title}>{content.title}</h1>
          <p className={theme.auth.description}>{content.description}</p>

          <div className={theme.auth.linkRow}>
            <Link href="/postings" className={theme.auth.utilityLink}>
              Browse postings
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/" className={theme.auth.utilityLink}>
              Back to home
            </Link>
          </div>

          <div className={theme.auth.featureGrid}>
            {content.features.map((feature) => {
              const Icon = feature.icon;

              return (
                <article key={feature.title} className={theme.auth.featureCard}>
                  <div className={theme.auth.featureIcon}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h2 className={theme.auth.featureTitle}>{feature.title}</h2>
                  <p className={theme.auth.featureDescription}>
                    {feature.description}
                  </p>
                </article>
              );
            })}
          </div>

          <section className={theme.auth.spotlight}>
            <p className={theme.auth.spotlightLabel}>
              {content.spotlightLabel}
            </p>
            <h2 className={theme.auth.spotlightTitle}>
              {content.spotlightTitle}
            </h2>
            <p className={theme.auth.spotlightDescription}>
              {content.spotlightDescription}
            </p>

            <div className={theme.auth.spotlightList}>
              {content.spotlightItems.map((item) => (
                <div key={item} className={theme.auth.spotlightItem}>
                  <Sparkles
                    className="mt-0.5 h-4 w-4 shrink-0 text-violet-600"
                    aria-hidden="true"
                  />
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </section>
        </section>

        <section className={theme.auth.formColumn}>
          <div className="w-full">{children}</div>
        </section>
      </div>
    </main>
  );
}
