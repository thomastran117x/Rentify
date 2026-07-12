import { theme } from "@/styles/theme";
import type {
  ActiveOrganizationSummary,
  AuthResponseUser,
} from "@/lib/auth/types";
import {
  canManageOrganizationPostings,
  canReadOrganizationPostings,
  isModeratorRole,
  isOwnerRole,
} from "@/lib/auth/roles";

export interface HeaderNavigationLink {
  href: string;
  label: string;
}

export interface HeaderAccountLink {
  href: string;
  label: string;
  description: string;
}

export type SiteHeaderAuthStatus = "loading" | "anonymous" | "authenticated";
export type SiteHeaderUserRole = AuthResponseUser["role"];

export const navigationLinks: HeaderNavigationLink[] = [
  { href: "/postings", label: "Browse" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/services", label: "Services" },
  { href: "/contact", label: "Contact" },
];

export function getAccountLinks(
  role?: SiteHeaderUserRole,
  options?: {
    organizationMembershipCount?: number;
    hasActiveOrganization?: boolean;
    activeOrganization?: ActiveOrganizationSummary;
  },
): HeaderAccountLink[] {
  // The account menu only renders for authenticated users, so surface
  // Organizations to everyone: members manage their teams, and users without an
  // organization yet can reach the workspace to create or join one.
  const showOrganizations = true;
  const showCreatePosting =
    isOwnerRole(role) ||
    canManageOrganizationPostings(options?.activeOrganization);
  const showPostingsDashboard = canReadOrganizationPostings(
    options?.activeOrganization,
  );

  return [
    ...(isOwnerRole(role)
      ? [
          {
            href: "/dashboard",
            label: "Dashboard",
            description: "Manage listings, bookings, and performance",
          },
        ]
      : []),
    ...(showPostingsDashboard
      ? [
          {
            href: "/postings/manage",
            label: "Postings",
            description:
              "Manage every listing for your active organization by status",
          },
        ]
      : []),
    ...(showCreatePosting
      ? [
          {
            href: "/postings/create",
            label: "Create posting",
            description:
              "Create and manage drafts for your active organization",
          },
        ]
      : []),
    ...(isModeratorRole(role)
      ? [
          {
            href: "/moderation",
            label: "Moderation",
            description: "Review reports and keep the marketplace safe",
          },
        ]
      : []),
    ...(showOrganizations
      ? [
          {
            href: "/organizations",
            label: "Organizations",
            description: "Switch organizations, invites, and team roles",
          },
        ]
      : []),
    {
      href: "/bookings",
      label: "Bookings",
      description: isOwnerRole(role)
        ? "Track renter and owner booking work in one place"
        : "Track requests, payments, and upcoming rentings",
    },
    {
      href: "/account",
      label: "Manage account",
      description: "Email, security, and login methods",
    },
  ];
}

function getInitials(value: string): string {
  return (
    value
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "R"
  );
}

export function getDisplayLabel(email: string, username: string): string {
  return username.trim() || email.split("@")[0] || "Account";
}

export function isRouteActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

export function SiteHeaderLogo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className={theme.header.logoMark}>R</div>
      <p className="text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
        Rentify
      </p>
    </div>
  );
}

interface IconProps {
  className?: string;
}

export function SearchIcon({ className = "h-4 w-4" }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
      aria-hidden="true"
    >
      <path
        d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

export function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface UserAvatarProps {
  name: string;
  imageUrl?: string | null;
}

export function UserAvatar({ name, imageUrl }: UserAvatarProps) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={`${name} avatar`}
        className="h-9 w-9 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700"
      />
    );
  }

  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white ring-1 ring-slate-200 dark:bg-slate-700 dark:ring-slate-600">
      {getInitials(name)}
    </div>
  );
}
