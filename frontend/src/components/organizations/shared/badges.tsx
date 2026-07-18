// Shared status badges and their style maps for the organization workspace.

import type {
  OrganizationAnnouncementStatus,
  OrganizationBlogStatus,
  OrganizationInviteStatus,
  OrganizationRole,
} from "@/lib/organizations/api";
import type { PostingStatus } from "@/lib/postings/api";
import { formatRole } from "@/components/organizations/shared/format";

export const ROLE_BADGE_STYLES: Record<OrganizationRole, string> = {
  primary_manager:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300",
  manager:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  operator:
    "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export const INVITE_STATUS_STYLES: Record<OrganizationInviteStatus, string> = {
  pending:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  accepted:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  revoked:
    "border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
  expired:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
};

export const POSTING_STATUS_STYLES: Record<PostingStatus, string> = {
  draft:
    "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  published:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  paused:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  archived:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
};

export const ANNOUNCEMENT_STATUS_STYLES: Record<
  OrganizationAnnouncementStatus,
  string
> = {
  draft:
    "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  published:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
};

export const BLOG_STATUS_STYLES: Record<OrganizationBlogStatus, string> = {
  draft:
    "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  published:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
};

export function RoleBadge({ role }: { role: OrganizationRole }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ROLE_BADGE_STYLES[role]}`}
    >
      {formatRole(role)}
    </span>
  );
}

export function InviteStatusBadge({
  status,
}: {
  status: OrganizationInviteStatus;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${INVITE_STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export function PostingStatusBadge({ status }: { status: PostingStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${POSTING_STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}
