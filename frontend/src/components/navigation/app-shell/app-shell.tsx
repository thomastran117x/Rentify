"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/auth-context";
import { theme } from "@/styles/theme";
import { AppSidebar } from "./app-sidebar";
import { isWorkspaceRoute } from "./nav-registry";

/**
 * Wraps authenticated workspace routes in a two-column app shell and leaves
 * every public route untouched.
 *
 * Deliberately renders an `<aside>` plus a plain `<div>` and never a second
 * `<main>` — each page still supplies its own full-bleed `<main>`, whose
 * background now fills the content column instead of the viewport.
 *
 * `usePathname()` is prerendered into the initial HTML, so the column is
 * reserved server-side and there is no layout shift. That holds while
 * `cacheComponents` is off in `next.config.ts`; enabling it would make this a
 * blocking client hook that needs a `<Suspense>` boundary.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, session } = useAuth();

  if (!isWorkspaceRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className={theme.sidebar.layout}>
      <AppSidebar pathname={pathname} status={status} session={session} />
      <div className={theme.sidebar.content}>{children}</div>
    </div>
  );
}
