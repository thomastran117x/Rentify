"use client";

import Link from "next/link";
import type { StoredAuthSession } from "@/lib/auth/types";
import { ThemeToggle } from "@/components/navigation/theme-toggle";
import { theme } from "@/styles/theme";
import { useDisclosureDetails } from "./use-disclosure-details";
import {
  accountMenuLinks,
  type SiteHeaderAuthStatus,
  UserAvatar,
} from "./site-header.shared";

interface AccountIdentityProps {
  session: StoredAuthSession;
  displayName: string;
}

function AccountIdentity({ session, displayName }: AccountIdentityProps) {
  const avatarName = session.user.username || session.user.email;

  return (
    <>
      <UserAvatar name={avatarName} imageUrl={session.user.avatarUrl ?? null} />

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">
          {displayName}
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {session.user.email}
        </p>
      </div>
    </>
  );
}

interface SiteHeaderDesktopAccountProps {
  pathname: string;
  status: SiteHeaderAuthStatus;
  session: StoredAuthSession | null;
  displayName: string;
  logoutPending: boolean;
  onLogout: () => Promise<void>;
}

export function SiteHeaderDesktopAccount({
  pathname,
  status,
  session,
  displayName,
  logoutPending,
  onLogout,
}: SiteHeaderDesktopAccountProps) {
  const { ref, open, onToggle } = useDisclosureDetails();

  if (status === "loading") {
    return <div className={theme.header.avatarSkeleton} aria-hidden="true" />;
  }

  if (status === "authenticated" && session) {
    const avatarName = session.user.username || session.user.email;

    return (
      <details ref={ref} onToggle={onToggle} className="group relative">
        <summary
          className={theme.header.desktopAccountTrigger}
          aria-label={`${displayName} account menu`}
          aria-expanded={open}
        >
          <UserAvatar
            name={avatarName}
            imageUrl={session.user.avatarUrl ?? null}
          />
        </summary>

        <div className={theme.header.dropdown}>
          <div className={theme.header.dropdownHighlight}>
            <div className="flex items-center gap-3">
              <AccountIdentity session={session} displayName={displayName} />
            </div>
          </div>

          <div className="mt-2 grid gap-1">
            {accountMenuLinks.map((link) => {
              const Icon = link.icon;

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={theme.header.dropdownItem}
                >
                  <Icon className={theme.header.dropdownItemIcon} />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </div>

          <div className={theme.header.dropdownDivider} />

          <div className={theme.header.dropdownThemeRow}>
            <span>Theme</span>
            <ThemeToggle />
          </div>

          <div className={theme.header.dropdownDivider} />

          <button
            type="button"
            onClick={() => {
              void onLogout();
            }}
            disabled={logoutPending}
            className={theme.header.logoutButton}
          >
            {logoutPending ? "Logging out..." : "Log out"}
          </button>
        </div>
      </details>
    );
  }

  if (pathname === "/login") {
    return null;
  }

  return (
    <Link href="/login" className={theme.header.authLinkPrimary}>
      Log in
    </Link>
  );
}
