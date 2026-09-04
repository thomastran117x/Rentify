"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { authApi } from "@/lib/auth/api";
import { ApiError } from "@/lib/auth/types";
import { canManageOrganizationPostings, isOwnerRole } from "@/lib/auth/roles";
import { theme } from "@/styles/theme";
import { ThemeToggle } from "@/components/navigation/theme-toggle";
import { SiteHeaderDesktopAccount } from "./site-header-account-panels";
import { SiteHeaderMobileMenu } from "./site-header-mobile-menu";
import { SiteHeaderDesktopNav } from "./site-header-navigation";
import { SiteHeaderSearchForm } from "./site-header-search-form";
import {
  CloseIcon,
  getDisplayLabel,
  SearchIcon,
  SiteHeaderLogo,
} from "./site-header.shared";

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { status, session, clearSession } = useAuth();
  const [logoutPending, setLogoutPending] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const desktopSearchInputRef = useRef<HTMLInputElement>(null);

  const displayName = session
    ? getDisplayLabel(session.user.email, session.user.username)
    : "Account";

  const userCanCreatePosting =
    isOwnerRole(session?.user.role) ||
    canManageOrganizationPostings(session?.user.activeOrganization);
  const mobileCtaHref = userCanCreatePosting ? "/postings/create" : "/signup";
  const mobileCtaLabel = userCanCreatePosting
    ? "Create posting"
    : "List a rental";

  useEffect(() => {
    if (mobileSearchOpen) {
      mobileSearchInputRef.current?.focus();
    }
  }, [mobileSearchOpen]);

  useEffect(() => {
    if (!mobileSearchOpen) {
      return;
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileSearchOpen(false);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mobileSearchOpen]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (window.innerWidth >= 1024 && desktopSearchInputRef.current) {
          desktopSearchInputRef.current.focus();
          desktopSearchInputRef.current.select();
        } else {
          setMobileSearchOpen(true);
        }
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMobileSearchOpen(false);

    const query = searchQuery.trim();

    if (!query) {
      router.push("/postings");
      return;
    }

    router.push(`/postings?q=${encodeURIComponent(query)}`);
  }

  async function handleLogout() {
    setLogoutPending(true);

    try {
      await authApi.logout();
      clearSession();
      router.push("/login");
    } catch (error) {
      clearSession();

      if (error instanceof ApiError && error.status === 401) {
        router.push("/login");
        return;
      }

      router.push("/login");
    } finally {
      setLogoutPending(false);
    }
  }

  return (
    <header className={theme.header.shell}>
      <div className={theme.header.container}>
        <div className={theme.header.leftCluster}>
          <Link href="/" className="group shrink-0">
            <SiteHeaderLogo />
          </Link>

          <SiteHeaderDesktopNav pathname={pathname} />
        </div>

        <div className={theme.header.rightCluster}>
          <SiteHeaderSearchForm
            query={searchQuery}
            onQueryChange={setSearchQuery}
            onSubmit={handleSearch}
            variant="desktop"
            inputRef={desktopSearchInputRef}
          />

          <button
            type="button"
            onClick={() => setMobileSearchOpen((open) => !open)}
            className={`${theme.header.iconButton} lg:hidden`}
            aria-label={mobileSearchOpen ? "Close search" : "Open search"}
            aria-expanded={mobileSearchOpen}
          >
            {mobileSearchOpen ? (
              <CloseIcon />
            ) : (
              <SearchIcon className="h-5 w-5" />
            )}
          </button>

          {status !== "authenticated" ? <ThemeToggle /> : null}

          <SiteHeaderDesktopAccount
            pathname={pathname}
            status={status}
            session={session}
            displayName={displayName}
            logoutPending={logoutPending}
            onLogout={handleLogout}
          />

          <SiteHeaderMobileMenu
            pathname={pathname}
            mobileCtaHref={mobileCtaHref}
            mobileCtaLabel={mobileCtaLabel}
          />
        </div>
      </div>

      {mobileSearchOpen ? (
        <div className={theme.header.mobileSearchPanel}>
          <SiteHeaderSearchForm
            query={searchQuery}
            onQueryChange={setSearchQuery}
            onSubmit={handleSearch}
            variant="mobile"
            inputRef={mobileSearchInputRef}
          />
        </div>
      ) : null}
    </header>
  );
}
