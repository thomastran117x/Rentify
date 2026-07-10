import type { ReactNode } from "react";
import Link from "next/link";
import { MarketingHeroSearch } from "@/components/marketing/marketing-hero-search";

interface MarketingPageStat {
  label: string;
  value: string;
}

interface MarketingPageQuickLink {
  href: string;
  label: string;
}

interface MarketingPageShellProps {
  eyebrow: string;
  title: string;
  description: string;
  accent: string;
  children: ReactNode;
  aside?: ReactNode;
  ctaLabel?: string;
  ctaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  quickLinks?: ReadonlyArray<MarketingPageQuickLink>;
  stats?: ReadonlyArray<MarketingPageStat>;
}

export function MarketingPageShell({
  eyebrow,
  title,
  description,
  accent,
  children,
  aside,
  ctaLabel = "Talk to our team",
  ctaHref = "/contact",
  secondaryCtaLabel = "Browse rentals",
  secondaryCtaHref = "/postings",
  quickLinks = [],
  stats = [],
}: MarketingPageShellProps) {
  return (
    <main className="min-h-screen bg-white text-slate-950 dark:bg-slate-950 dark:text-white">
      <section className="relative overflow-hidden border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(124,58,237,0.12),transparent_28%),radial-gradient(circle_at_85%_20%,rgba(99,102,241,0.10),transparent_24%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] dark:bg-[radial-gradient(circle_at_20%_15%,rgba(124,58,237,0.18),transparent_30%),radial-gradient(circle_at_85%_20%,rgba(59,130,246,0.14),transparent_26%),linear-gradient(180deg,#020617_0%,#0b1120_100%)]" />
        <div className="absolute -left-14 top-10 h-44 w-44 rounded-full bg-violet-200/45 blur-3xl dark:bg-violet-500/10" />
        <div className="absolute -right-14 top-14 h-56 w-56 rounded-full bg-indigo-200/40 blur-3xl dark:bg-indigo-500/10" />

        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.08fr_0.92fr] lg:items-end lg:px-8 lg:py-24">
          <div>
            <p className="inline-flex items-center rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 shadow-sm dark:border-violet-900/60 dark:bg-slate-900 dark:text-violet-300">
              {eyebrow}
            </p>
            <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-[-0.055em] text-slate-950 sm:text-6xl lg:text-7xl dark:text-white">
              {title}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg dark:text-slate-300">
              {description}
            </p>
            <MarketingHeroSearch />
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link
                href={ctaHref}
                className="inline-flex items-center justify-center rounded-2xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-md hover:shadow-violet-600/25"
              >
                {ctaLabel}
              </Link>
              <Link
                href={secondaryCtaHref}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300"
              >
                {secondaryCtaLabel}
              </Link>
            </div>

            {quickLinks.length ? (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  Quick links:
                </span>
                {quickLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            ) : null}

            {stats.length ? (
              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                {stats.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/90"
                  >
                    <p className="text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                      {item.value}
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {item.label}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {aside ? (
            <aside className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-white/95 p-6 shadow-2xl shadow-slate-950/10 backdrop-blur sm:p-7 dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-black/50">
              <div
                className="pointer-events-none absolute inset-x-6 top-0 h-24 rounded-b-[1.75rem] opacity-60 blur-2xl"
                style={{
                  backgroundImage: `linear-gradient(135deg, ${accent}, rgba(255,255,255,0) 72%)`,
                }}
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute inset-x-10 top-0 h-px"
                style={{
                  backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0), ${accent}, rgba(255,255,255,0))`,
                }}
                aria-hidden="true"
              />
              <div className="relative">{aside}</div>
            </aside>
          ) : null}
        </div>
      </section>

      <div className="px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </div>
    </main>
  );
}
