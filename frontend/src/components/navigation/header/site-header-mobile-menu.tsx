import Link from "next/link";
import type { StoredAuthSession } from "@/lib/auth/types";
import { theme } from "@/styles/theme";
import { SiteHeaderMobileAccountSection } from "./site-header-account-panels";
import { SiteHeaderMobileNavGrid } from "./site-header-navigation";
import {
  type HeaderAccountLink,
  MenuIcon,
  type SiteHeaderAuthStatus,
} from "./site-header.shared";

interface SiteHeaderMobileMenuProps {
  pathname: string;
  status: SiteHeaderAuthStatus;
  session: StoredAuthSession | null;
  displayName: string;
  accountLinks: HeaderAccountLink[];
  logoutPending: boolean;
  onLogout: () => Promise<void>;
  mobileCtaHref: string;
  mobileCtaLabel: string;
}

export function SiteHeaderMobileMenu({
  pathname,
  status,
  session,
  displayName,
  accountLinks,
  logoutPending,
  onLogout,
  mobileCtaHref,
  mobileCtaLabel,
}: SiteHeaderMobileMenuProps) {
  return (
    <details className="group relative md:hidden">
      <summary className={theme.header.iconButton} aria-label="Open menu">
        <MenuIcon />
      </summary>

      <div className={theme.header.mobileDropdown}>
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Explore
          </p>

          <SiteHeaderMobileNavGrid pathname={pathname} />

          <div className="border-t border-slate-200 mt-3 pt-3">
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

          {status === "authenticated" && session ? (
            <div className="border-t border-slate-200 mt-3 pt-3">
              <SiteHeaderMobileAccountSection
                status={status}
                session={session}
                displayName={displayName}
                accountLinks={accountLinks}
                logoutPending={logoutPending}
                onLogout={onLogout}
              />
            </div>
          ) : null}
        </div>
      </div>
    </details>
  );
}
