// Single source of truth for the authenticated app-shell sidebar: which routes
// get the shell, which destinations each role may open, and which item a given
// pathname marks active. Mirrors the shape of the organization workspace's
// `section-registry.ts` — a module-level array plus derived selectors.

import type { ComponentType } from "react";
import {
  BookmarkCheck,
  Building2,
  CalendarCheck,
  CirclePlus,
  ClipboardList,
  Gauge,
  Heart,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import {
  type AppUserRole,
  canManageOrganizationPostings,
  canReadOrganizationPostings,
  isModeratorRole,
  isOwnerRole,
} from "@/lib/auth/roles";
import type { ActiveOrganizationSummary } from "@/lib/auth/types";
import { isRouteActive } from "@/lib/navigation/is-route-active";

export type AppNavGroupId = "workspace" | "activity" | "account";

export type AppNavItemId =
  | "dashboard"
  | "postings"
  | "create-posting"
  | "moderation"
  | "bookings"
  | "saved"
  | "saved-searches"
  | "organizations"
  | "account";

export interface AppNavGate {
  /** Site-wide role from `session.user.role`. */
  role?: AppUserRole;
  /** Active organization membership from `session.user.activeOrganization`. */
  activeOrganization?: ActiveOrganizationSummary;
}

export interface AppNavItem {
  id: AppNavItemId;
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  group: AppNavGroupId;
  /** Extra path prefixes that mark this item active without a link of their own. */
  matchPrefixes?: string[];
  canAccess: (gate: AppNavGate) => boolean;
}

export const APP_NAV_GROUPS: { id: AppNavGroupId; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "activity", label: "Your activity" },
  { id: "account", label: "Account" },
];

const always = (): boolean => true;

export const APP_NAV_ITEMS: AppNavItem[] = [
  {
    id: "dashboard",
    href: "/dashboard",
    label: "Dashboard",
    icon: Gauge,
    group: "workspace",
    matchPrefixes: ["/dashboard/postings"],
    canAccess: ({ role }) => isOwnerRole(role),
  },
  {
    id: "postings",
    href: "/postings/manage",
    label: "Postings",
    icon: ClipboardList,
    group: "workspace",
    canAccess: ({ activeOrganization }) =>
      canReadOrganizationPostings(activeOrganization),
  },
  {
    id: "create-posting",
    href: "/postings/create",
    label: "Create posting",
    icon: CirclePlus,
    group: "workspace",
    canAccess: ({ role, activeOrganization }) =>
      isOwnerRole(role) || canManageOrganizationPostings(activeOrganization),
  },
  {
    id: "moderation",
    href: "/moderation",
    label: "Moderation",
    icon: ShieldCheck,
    group: "workspace",
    canAccess: ({ role }) => isModeratorRole(role),
  },
  {
    id: "bookings",
    href: "/bookings",
    label: "Bookings",
    icon: CalendarCheck,
    group: "activity",
    matchPrefixes: ["/rentings"],
    canAccess: always,
  },
  {
    id: "saved",
    href: "/saved",
    label: "Saved",
    icon: Heart,
    group: "activity",
    canAccess: always,
  },
  {
    id: "saved-searches",
    href: "/saved/searches",
    label: "Saved searches",
    icon: BookmarkCheck,
    group: "activity",
    canAccess: always,
  },
  {
    // Always visible: members manage their teams, and users without an
    // organization yet need a way into the workspace to create or join one.
    id: "organizations",
    href: "/dashboard/organizations",
    label: "Organizations",
    icon: Building2,
    group: "account",
    canAccess: always,
  },
  {
    id: "account",
    href: "/account",
    label: "Manage account",
    icon: UserCog,
    group: "account",
    canAccess: always,
  },
];

/**
 * Route prefixes that render the app shell. Deliberately excludes the public
 * marketplace (`/postings`, `/postings/[id]`), the marketing pages, and auth.
 */
export const WORKSPACE_ROUTE_PREFIXES: string[] = [
  "/dashboard",
  "/postings/manage",
  "/postings/create",
  "/bookings",
  "/rentings",
  "/saved",
  "/moderation",
  "/account",
];

export function isWorkspaceRoute(pathname: string): boolean {
  return WORKSPACE_ROUTE_PREFIXES.some((prefix) =>
    isRouteActive(pathname, prefix),
  );
}

export function getAccessibleNavItems(gate: AppNavGate): AppNavItem[] {
  return APP_NAV_ITEMS.filter((item) => item.canAccess(gate));
}

/**
 * Longest match wins. Plain prefix matching is not enough on its own because
 * `/dashboard/organizations/team` is nested under both `/dashboard` and
 * `/dashboard/organizations` — the deeper item must claim it.
 */
export function findActiveNavItem(pathname: string): AppNavItem | undefined {
  let match: AppNavItem | undefined;
  let matchLength = -1;

  for (const item of APP_NAV_ITEMS) {
    for (const prefix of [item.href, ...(item.matchPrefixes ?? [])]) {
      if (isRouteActive(pathname, prefix) && prefix.length > matchLength) {
        match = item;
        matchLength = prefix.length;
      }
    }
  }

  return match;
}
