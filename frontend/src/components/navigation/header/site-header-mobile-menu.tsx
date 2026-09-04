"use client";

import Link from "next/link";
import { theme } from "@/styles/theme";
import { useDisclosureDetails } from "./use-disclosure-details";
import { SiteHeaderMobileNavGrid } from "./site-header-navigation";
import { MenuIcon } from "./site-header.shared";

interface SiteHeaderMobileMenuProps {
  pathname: string;
  mobileCtaHref: string;
  mobileCtaLabel: string;
}

/**
 * Small-screen menu for the public navigation only. Account actions and the
 * theme control live in the avatar dropdown, which renders at every width, and
 * workspace navigation lives in the app-shell sidebar.
 */
export function SiteHeaderMobileMenu({
  pathname,
  mobileCtaHref,
  mobileCtaLabel,
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
