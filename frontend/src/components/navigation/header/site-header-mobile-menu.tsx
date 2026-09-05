"use client";

import Link from "next/link";
import { ThemeToggle } from "@/components/navigation/theme-toggle";
import { theme } from "@/styles/theme";
import { useDisclosureDetails } from "./use-disclosure-details";
import { SiteHeaderMobileNavGrid } from "./site-header-navigation";
import { MenuIcon } from "./site-header.shared";

interface SiteHeaderMobileMenuProps {
  pathname: string;
  mobileCtaHref: string;
  mobileCtaLabel: string;
  /** Anonymous visitors have no account dropdown to hold the theme control. */
  showThemeRow: boolean;
}

/**
 * Small-screen menu for the public navigation. Account actions live in the
 * avatar dropdown, which renders at every width, and workspace navigation lives
 * in the app-shell sidebar — so this carries the theme control only for
 * anonymous visitors, who have no dropdown.
 */
export function SiteHeaderMobileMenu({
  pathname,
  mobileCtaHref,
  mobileCtaLabel,
  showThemeRow,
}: SiteHeaderMobileMenuProps) {
  const { ref, open, onToggle } = useDisclosureDetails();

  return (
    <details ref={ref} onToggle={onToggle} className="group relative md:hidden">
      <summary
        className={theme.header.iconButton}
        aria-label="Open menu"
        aria-expanded={open}
      >
        <MenuIcon />
      </summary>

      <div className={theme.header.mobileDropdown}>
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
            Explore
          </p>

          <SiteHeaderMobileNavGrid pathname={pathname} />

          {showThemeRow ? (
            <div
              data-auth-hidden
              className="border-t border-slate-200 dark:border-slate-800 mt-3 pt-3 flex items-center justify-between"
            >
              <span className="px-1 text-sm font-medium text-slate-600 dark:text-slate-300">
                Theme
              </span>
              <ThemeToggle />
            </div>
          ) : null}

          <div className="border-t border-slate-200 dark:border-slate-800 mt-3 pt-3">
            <Link href={mobileCtaHref} className={theme.header.mobileCta}>
              <span>{mobileCtaLabel}</span>
              <span
                aria-hidden="true"
                className="transition duration-200 group-hover:translate-x-0.5"
              >
                &rarr;
              </span>
            </Link>
          </div>
        </div>
      </div>
    </details>
  );
}
