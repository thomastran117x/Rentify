import Link from "next/link";
import type { StoredAuthSession } from "@/lib/auth/types";
import { theme } from "@/styles/theme";
import {
  type HeaderAccountLink,
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
        <p className="truncate text-sm font-semibold text-slate-950">
          {displayName}
        </p>
        <p className="truncate text-xs text-slate-500">{session.user.email}</p>
      </div>
    </>
  );
}

interface AccountLinksListProps {
  accountLinks: HeaderAccountLink[];
  descriptionClassName: string;
  logoutPending: boolean;
  onLogout: () => Promise<void>;
  showDivider?: boolean;
  wrapperClassName: string;
}

function AccountLinksList({
  accountLinks,
  descriptionClassName,
  logoutPending,
  onLogout,
  showDivider = false,
  wrapperClassName,
}: AccountLinksListProps) {
  return (
    <div className={wrapperClassName}>
      {accountLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={theme.header.dropdownItem}
        >
          <p className="text-sm font-medium text-slate-950">{link.label}</p>
          <p className={descriptionClassName}>{link.description}</p>
        </Link>
      ))}

      {showDivider ? <div className="my-2 h-px bg-slate-200" /> : null}

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
  );
}

interface SiteHeaderDesktopAccountProps {
  pathname: string;
  status: SiteHeaderAuthStatus;
  session: StoredAuthSession | null;
  displayName: string;
  accountLinks: HeaderAccountLink[];
  logoutPending: boolean;
  onLogout: () => Promise<void>;
}

export function SiteHeaderDesktopAccount({
  pathname,
  status,
  session,
  displayName,
  accountLinks,
  logoutPending,
  onLogout,
}: SiteHeaderDesktopAccountProps) {
  if (status === "loading") {
    return <div className={theme.header.avatarSkeleton} aria-hidden="true" />;
  }

  if (status === "authenticated" && session) {
    const avatarName = session.user.username || session.user.email;

    return (
      <details className="group relative">
        <summary
          className={theme.header.desktopAccountTrigger}
          aria-label={`${displayName} account menu`}
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

          <AccountLinksList
            accountLinks={accountLinks}
            descriptionClassName="mt-0.5 text-xs leading-5 text-slate-500"
            logoutPending={logoutPending}
            onLogout={onLogout}
            showDivider
            wrapperClassName="mt-2 grid gap-1"
          />
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

interface SiteHeaderMobileAccountSectionProps {
  status: SiteHeaderAuthStatus;
  session: StoredAuthSession | null;
  displayName: string;
  accountLinks: HeaderAccountLink[];
  logoutPending: boolean;
  onLogout: () => Promise<void>;
}

export function SiteHeaderMobileAccountSection({
  status,
  session,
  displayName,
  accountLinks,
  logoutPending,
  onLogout,
}: SiteHeaderMobileAccountSectionProps) {
  if (status === "authenticated" && session) {
    return (
      <>
        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-violet-100 bg-violet-50 p-3">
          <AccountIdentity session={session} displayName={displayName} />
        </div>

        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Account
        </p>

        <AccountLinksList
          accountLinks={accountLinks}
          descriptionClassName="mt-0.5 text-xs text-slate-500"
          logoutPending={logoutPending}
          onLogout={onLogout}
          wrapperClassName="grid gap-1"
        />
      </>
    );
  }

  return null;
}
