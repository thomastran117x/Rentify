"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useAuth } from "@/components/auth/auth-context";
import { FormErrorMessage, useErrorToast } from "@/components/errors";
import { blobApi } from "@/lib/blob/api";
import { authApi } from "@/lib/auth/api";
import { canManageOrganizationPostings } from "@/lib/auth/roles";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  organizationsApi,
  type CreateOrganizationInviteInput,
  type OrganizationAuditRecord,
  type OrganizationDetailResult,
  type OrganizationInviteStatus,
  type OrganizationProfileInput,
  type OrganizationRole,
  type OrganizationWorkspaceResult,
} from "@/lib/organizations/api";
import {
  postingsApi,
  type PostingRecord,
  type PostingStatus,
} from "@/lib/postings/api";

function formatRole(role: OrganizationRole): string {
  return role
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatAuditAction(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll(".", " ")
    .split(" ")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function getInitials(value: string): string {
  return (
    value
      .split(/[\s._@-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function isInviteCapable(role?: OrganizationRole): boolean {
  return role === "primary_manager" || role === "manager";
}

const ROLE_BADGE_STYLES: Record<OrganizationRole, string> = {
  primary_manager:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300",
  manager:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  operator:
    "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const INVITE_STATUS_STYLES: Record<OrganizationInviteStatus, string> = {
  pending:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  accepted:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  revoked:
    "border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
  expired:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
};

const POSTING_STATUS_STYLES: Record<PostingStatus, string> = {
  draft:
    "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  published:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  paused:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  archived:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
};

function formatPostingVariant(posting: PostingRecord): string {
  return `${posting.variant.family} / ${posting.variant.subtype}`.replaceAll(
    "_",
    " ",
  );
}

type PostingLifecycleAction = "publish" | "pause" | "unpause" | "archive";
type WorkspaceTab = "overview" | "team" | "postings" | "activity" | "settings";

function postingLifecycleActions(status: PostingStatus): Array<{
  id: PostingLifecycleAction;
  label: string;
  tone: "primary" | "muted";
}> {
  if (status === "draft") {
    return [
      { id: "publish", label: "Publish", tone: "primary" },
      { id: "archive", label: "Archive", tone: "muted" },
    ];
  }
  if (status === "published") {
    return [
      { id: "pause", label: "Pause", tone: "muted" },
      { id: "archive", label: "Archive", tone: "muted" },
    ];
  }
  if (status === "paused") {
    return [
      { id: "unpause", label: "Unpause", tone: "primary" },
      { id: "archive", label: "Archive", tone: "muted" },
    ];
  }
  return [];
}

const rowActionMutedClass =
  "inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-900/60 dark:hover:bg-sky-950/30 dark:hover:text-sky-300";

const rowActionPrimaryClass =
  "inline-flex h-9 items-center justify-center rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200";

const POSTINGS_PREVIEW_LIMIT = 5;

const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition duration-200 placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-400 dark:focus:ring-sky-500/20";

const primaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm shadow-slate-950/15 transition duration-200 hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-md hover:shadow-slate-950/20 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200";

const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-900/60 dark:hover:bg-sky-950/30 dark:hover:text-sky-300";

const dangerButtonClass =
  "inline-flex h-10 items-center justify-center rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 transition duration-200 hover:-translate-y-0.5 hover:bg-rose-50 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/40";

const WORKSPACE_TAB_DEFINITIONS: Array<{
  id: WorkspaceTab;
  label: string;
  description: string;
}> = [
  {
    id: "overview",
    label: "Overview",
    description: "A cleaner snapshot of the organization and key next actions.",
  },
  {
    id: "team",
    label: "Team",
    description: "Invites, roles, and membership management in one place.",
  },
  {
    id: "postings",
    label: "Postings",
    description:
      "Listing previews and lifecycle actions for this organization.",
  },
  {
    id: "activity",
    label: "Activity",
    description: "Recent changes, audit history, and restorable versions.",
  },
  {
    id: "settings",
    label: "Settings",
    description:
      "Organization profile and contact details for primary managers.",
  },
];

function isWorkspaceTab(value: string | null): value is WorkspaceTab {
  return WORKSPACE_TAB_DEFINITIONS.some((tab) => tab.id === value);
}

function getAllowedTabs(role?: OrganizationRole): WorkspaceTab[] {
  if (role === "primary_manager") {
    return ["overview", "team", "postings", "activity", "settings"];
  }
  if (role === "manager") {
    return ["overview", "team", "postings", "activity"];
  }
  return ["overview", "team", "postings"];
}

function resolveWorkspaceTab(
  value: string | null,
  allowedTabs: WorkspaceTab[],
): WorkspaceTab {
  if (isWorkspaceTab(value) && allowedTabs.includes(value)) {
    return value;
  }
  return allowedTabs[0] ?? "overview";
}

function tabButtonId(tab: WorkspaceTab): string {
  return `organization-workspace-tab-${tab}`;
}

function tabPanelId(tab: WorkspaceTab): string {
  return `organization-workspace-panel-${tab}`;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 shadow-sm dark:border-amber-900/60 dark:bg-slate-900 dark:text-amber-300">
      {children}
    </span>
  );
}

function RoleBadge({ role }: { role: OrganizationRole }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ROLE_BADGE_STYLES[role]}`}
    >
      {formatRole(role)}
    </span>
  );
}

function InviteStatusBadge({ status }: { status: OrganizationInviteStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${INVITE_STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

function PostingStatusBadge({ status }: { status: PostingStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${POSTING_STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

function Avatar({ name, imageUrl }: { name: string; imageUrl?: string }) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={`${name} avatar`}
        className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700"
      />
    );
  }

  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-900 to-sky-700 text-sm font-semibold text-white ring-1 ring-white/20 dark:from-slate-100 dark:to-sky-300 dark:text-slate-950">
      {getInitials(name)}
    </div>
  );
}

function StatTile({
  eyebrow,
  value,
  detail,
  accent,
}: {
  eyebrow: string;
  value: ReactNode;
  detail: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-[0_16px_40px_-24px_rgba(15,23,42,0.25)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
      <div className={`h-1.5 w-14 rounded-full bg-gradient-to-r ${accent}`} />
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
        {eyebrow}
      </p>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
        {value}
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {detail}
      </p>
    </div>
  );
}

function SectionCard({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.35)] sm:p-7 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
            {title}
          </h2>
          {description ? (
            <p className="mt-1.5 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function WorkspaceTabPanel({
  tab,
  activeTab,
  children,
}: {
  tab: WorkspaceTab;
  activeTab: WorkspaceTab;
  children: ReactNode;
}) {
  if (tab !== activeTab) {
    return null;
  }

  return (
    <section
      role="tabpanel"
      id={tabPanelId(tab)}
      aria-labelledby={tabButtonId(tab)}
      className="space-y-6"
    >
      {children}
    </section>
  );
}

function WorkspaceQuickActionCard({
  eyebrow,
  title,
  description,
  meta,
  onClick,
}: {
  eyebrow: string;
  title: string;
  description: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full w-full flex-col rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:bg-white hover:shadow-[0_20px_55px_-35px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-slate-950/35 dark:hover:border-sky-900/60 dark:hover:bg-slate-950/60"
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
        {eyebrow}
      </span>
      <span className="mt-3 text-lg font-semibold tracking-[-0.02em] text-slate-950 transition group-hover:text-sky-700 dark:text-white dark:group-hover:text-sky-300">
        {title}
      </span>
      <span className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
        {description}
      </span>
      <span className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">
        {meta}
      </span>
      <span className="mt-4 text-sm font-semibold text-sky-700 dark:text-sky-300">
        Open section
      </span>
    </button>
  );
}

function SurfaceNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300">
      {children}
    </div>
  );
}
interface ProfileFormValue {
  description: string;
  websiteUrl: string;
  contactEmail: string;
  contactPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  country: string;
  postalCode: string;
  logoUrl: string;
  logoBlobName: string;
  customFields: { key: string; value: string }[];
}

function emptyProfileForm(): ProfileFormValue {
  return {
    description: "",
    websiteUrl: "",
    contactEmail: "",
    contactPhone: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    region: "",
    country: "",
    postalCode: "",
    logoUrl: "",
    logoBlobName: "",
    customFields: [],
  };
}

function profileFormFromDetail(
  organization: OrganizationDetailResult["organization"],
): ProfileFormValue {
  return {
    description: organization.description ?? "",
    websiteUrl: organization.websiteUrl ?? "",
    contactEmail: organization.contactEmail ?? "",
    contactPhone: organization.contactPhone ?? "",
    addressLine1: organization.addressLine1 ?? "",
    addressLine2: organization.addressLine2 ?? "",
    city: organization.city ?? "",
    region: organization.region ?? "",
    country: organization.country ?? "",
    postalCode: organization.postalCode ?? "",
    logoUrl: organization.logoUrl ?? "",
    logoBlobName: organization.logoBlobName ?? "",
    customFields: Object.entries(organization.customFields ?? {}).map(
      ([key, value]) => ({ key, value }),
    ),
  };
}

function profileFormToInput(value: ProfileFormValue): OrganizationProfileInput {
  const toNull = (text: string): string | null => {
    const trimmed = text.trim();
    return trimmed.length === 0 ? null : trimmed;
  };

  const customFields: Record<string, string> = {};
  for (const row of value.customFields) {
    const key = row.key.trim();
    if (key.length > 0) {
      customFields[key] = row.value.trim();
    }
  }

  return {
    description: toNull(value.description),
    websiteUrl: toNull(value.websiteUrl),
    contactEmail: toNull(value.contactEmail),
    contactPhone: toNull(value.contactPhone),
    addressLine1: toNull(value.addressLine1),
    addressLine2: toNull(value.addressLine2),
    city: toNull(value.city),
    region: toNull(value.region),
    country: toNull(value.country),
    postalCode: toNull(value.postalCode),
    logoUrl: toNull(value.logoUrl),
    logoBlobName: toNull(value.logoBlobName),
    customFields: Object.keys(customFields).length > 0 ? customFields : null,
  };
}

const ORGANIZATION_LOGO_STORAGE_PREFIX =
  "organization-workspace:staged-logo-blobs";

function getOrganizationLogoStorageKey(userId: string): string {
  return `${ORGANIZATION_LOGO_STORAGE_PREFIX}:${userId}`;
}

function readStagedOrganizationLogoBlobNames(userId: string): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(
      getOrganizationLogoStorageKey(userId),
    );

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return [
      ...new Set(
        parsed
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

function writeStagedOrganizationLogoBlobNames(
  userId: string,
  blobNames: Iterable<string>,
): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedBlobNames = [
    ...new Set(
      Array.from(blobNames)
        .map((blobName) => blobName.trim())
        .filter(Boolean),
    ),
  ];
  const storageKey = getOrganizationLogoStorageKey(userId);

  if (normalizedBlobNames.length === 0) {
    window.sessionStorage.removeItem(storageKey);
    return;
  }

  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify(normalizedBlobNames),
  );
}

const fieldLabelClass =
  "text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400";

function OrganizationLogoField({
  logoUrl,
  onUploaded,
  onRemove,
  onError,
  disabled,
}: {
  logoUrl: string;
  onUploaded: (blobUrl: string, blobName: string) => void;
  onRemove: () => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }

    setUploading(true);
    try {
      const target = await blobApi.createUploadUrl({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        scope: "organizations",
      });
      const response = await fetch(target.uploadUrl, {
        method: target.method,
        headers: target.headers,
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}.`);
      }
      onUploaded(target.blobUrl, target.blobName);
    } catch {
      onError("We couldn't upload that logo. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-2">
      <span className={fieldLabelClass}>Logo</span>
      <div className="flex items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Organization logo"
            className="h-16 w-16 shrink-0 rounded-2xl object-cover ring-1 ring-slate-200 dark:ring-slate-700"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-dashed border-slate-300 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
            No logo
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${secondaryButtonClass} cursor-pointer`}>
            {uploading
              ? "Uploading..."
              : logoUrl
                ? "Replace logo"
                : "Upload logo"}
            <input
              type="file"
              accept="image/*"
              aria-label="Upload organization logo"
              className="sr-only"
              disabled={disabled || uploading}
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {logoUrl ? (
            <button
              type="button"
              onClick={onRemove}
              disabled={disabled || uploading}
              className={dangerButtonClass}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OrganizationProfileFieldset({
  value,
  onChange,
  onError,
  disabled,
}: {
  value: ProfileFormValue;
  onChange: (next: ProfileFormValue) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const update = <K extends keyof ProfileFormValue>(
    key: K,
    next: ProfileFormValue[K],
  ) => onChange({ ...value, [key]: next });

  return (
    <div className="grid gap-5">
      <label className="grid gap-2">
        <span className={fieldLabelClass}>Description</span>
        <textarea
          value={value.description}
          onChange={(event) => update("description", event.target.value)}
          rows={3}
          maxLength={5000}
          disabled={disabled}
          placeholder="Tell renters what your organization is about."
          className={`${inputClass} h-auto py-3`}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Website</span>
          <input
            value={value.websiteUrl}
            onChange={(event) => update("websiteUrl", event.target.value)}
            type="url"
            maxLength={500}
            disabled={disabled}
            placeholder="https://acme-rentals.com"
            className={inputClass}
          />
        </label>
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Contact email</span>
          <input
            value={value.contactEmail}
            onChange={(event) => update("contactEmail", event.target.value)}
            type="email"
            maxLength={320}
            disabled={disabled}
            placeholder="hello@acme-rentals.com"
            className={inputClass}
          />
        </label>
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Contact phone</span>
          <input
            value={value.contactPhone}
            onChange={(event) => update("contactPhone", event.target.value)}
            type="tel"
            maxLength={40}
            disabled={disabled}
            placeholder="+1 (555) 123-4567"
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 sm:col-span-2">
          <span className={fieldLabelClass}>Address line 1</span>
          <input
            value={value.addressLine1}
            onChange={(event) => update("addressLine1", event.target.value)}
            maxLength={200}
            disabled={disabled}
            placeholder="123 Market St"
            className={inputClass}
          />
        </label>
        <label className="grid gap-2 sm:col-span-2">
          <span className={fieldLabelClass}>Address line 2</span>
          <input
            value={value.addressLine2}
            onChange={(event) => update("addressLine2", event.target.value)}
            maxLength={200}
            disabled={disabled}
            placeholder="Suite 400"
            className={inputClass}
          />
        </label>
        <label className="grid gap-2">
          <span className={fieldLabelClass}>City</span>
          <input
            value={value.city}
            onChange={(event) => update("city", event.target.value)}
            maxLength={120}
            disabled={disabled}
            className={inputClass}
          />
        </label>
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Region / State</span>
          <input
            value={value.region}
            onChange={(event) => update("region", event.target.value)}
            maxLength={120}
            disabled={disabled}
            className={inputClass}
          />
        </label>
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Country</span>
          <input
            value={value.country}
            onChange={(event) => update("country", event.target.value)}
            maxLength={120}
            disabled={disabled}
            className={inputClass}
          />
        </label>
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Postal code</span>
          <input
            value={value.postalCode}
            onChange={(event) => update("postalCode", event.target.value)}
            maxLength={20}
            disabled={disabled}
            className={inputClass}
          />
        </label>
      </div>

      <OrganizationLogoField
        logoUrl={value.logoUrl}
        onUploaded={(blobUrl, blobName) =>
          onChange({ ...value, logoUrl: blobUrl, logoBlobName: blobName })
        }
        onRemove={() => onChange({ ...value, logoUrl: "", logoBlobName: "" })}
        onError={onError}
        disabled={disabled}
      />

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className={fieldLabelClass}>Custom fields</span>
          <button
            type="button"
            onClick={() =>
              update("customFields", [
                ...value.customFields,
                { key: "", value: "" },
              ])
            }
            disabled={disabled || value.customFields.length >= 20}
            className={secondaryButtonClass}
          >
            Add field
          </button>
        </div>
        {value.customFields.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Add your own labeled details such as Founded or License #.
          </p>
        ) : (
          <div className="grid gap-2">
            {value.customFields.map((row, index) => (
              <div
                key={index}
                className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]"
              >
                <input
                  value={row.key}
                  onChange={(event) => {
                    const next = [...value.customFields];
                    next[index] = { ...row, key: event.target.value };
                    update("customFields", next);
                  }}
                  maxLength={80}
                  disabled={disabled}
                  placeholder="Label"
                  aria-label={`Custom field ${index + 1} label`}
                  className={inputClass}
                />
                <input
                  value={row.value}
                  onChange={(event) => {
                    const next = [...value.customFields];
                    next[index] = { ...row, value: event.target.value };
                    update("customFields", next);
                  }}
                  maxLength={1000}
                  disabled={disabled}
                  placeholder="Value"
                  aria-label={`Custom field ${index + 1} value`}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() =>
                    update(
                      "customFields",
                      value.customFields.filter((_, i) => i !== index),
                    )
                  }
                  disabled={disabled}
                  className={dangerButtonClass}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface OrganizationCreateFormProps {
  name: string;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  saving: boolean;
  submitLabel: string;
  placeholder?: string;
  profile: ProfileFormValue;
  onProfileChange: (next: ProfileFormValue) => void;
  onProfileError: (message: string) => void;
}

function OrganizationCreateForm({
  name,
  onNameChange,
  onSubmit,
  saving,
  submitLabel,
  placeholder = "Acme Rentals",
  profile,
  onProfileChange,
  onProfileError,
}: OrganizationCreateFormProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="grid gap-4"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={placeholder}
          aria-label="Organization name"
          maxLength={160}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={saving || name.trim().length === 0}
          className={primaryButtonClass}
        >
          {saving ? "Creating..." : submitLabel}
        </button>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowDetails((current) => !current)}
          className="text-sm font-semibold text-sky-700 transition hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200"
        >
          {showDetails ? "Hide details" : "Add details (optional)"}
        </button>
      </div>

      {showDetails ? (
        <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-800 dark:bg-slate-950/30">
          <OrganizationProfileFieldset
            value={profile}
            onChange={onProfileChange}
            onError={onProfileError}
            disabled={saving}
          />
        </div>
      ) : null}
    </form>
  );
}

function formatAddress(
  organization: OrganizationDetailResult["organization"],
): string | null {
  const parts = [
    organization.addressLine1,
    organization.addressLine2,
    organization.city,
    organization.region,
    organization.postalCode,
    organization.country,
  ].filter((part): part is string => Boolean(part && part.trim().length > 0));
  return parts.length > 0 ? parts.join(", ") : null;
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <dt className={fieldLabelClass}>{label}</dt>
      <dd className="text-sm text-slate-700 dark:text-slate-200">{children}</dd>
    </div>
  );
}

function OrganizationAboutCard({
  organization,
}: {
  organization: OrganizationDetailResult["organization"];
}) {
  const address = formatAddress(organization);
  const customFields = Object.entries(organization.customFields ?? {});
  const hasContent =
    Boolean(organization.description) ||
    Boolean(organization.websiteUrl) ||
    Boolean(organization.contactEmail) ||
    Boolean(organization.contactPhone) ||
    Boolean(address) ||
    customFields.length > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <SectionCard eyebrow="About" title="Organization details">
      <div className="grid gap-6">
        {organization.description ? (
          <p className="whitespace-pre-line text-sm leading-6 text-slate-700 dark:text-slate-200">
            {organization.description}
          </p>
        ) : null}
        <dl className="grid gap-5 sm:grid-cols-2">
          {organization.websiteUrl ? (
            <DetailRow label="Website">
              <a
                href={organization.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
              >
                {organization.websiteUrl}
              </a>
            </DetailRow>
          ) : null}
          {organization.contactEmail ? (
            <DetailRow label="Contact email">
              <a
                href={`mailto:${organization.contactEmail}`}
                className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
              >
                {organization.contactEmail}
              </a>
            </DetailRow>
          ) : null}
          {organization.contactPhone ? (
            <DetailRow label="Contact phone">
              {organization.contactPhone}
            </DetailRow>
          ) : null}
          {address ? <DetailRow label="Address">{address}</DetailRow> : null}
          {customFields.map(([key, value]) => (
            <DetailRow key={key} label={key}>
              {value}
            </DetailRow>
          ))}
        </dl>
      </div>
    </SectionCard>
  );
}

function OrganizationBasicsCard({
  detail,
  membershipCount,
}: {
  detail: OrganizationDetailResult;
  membershipCount: number;
}) {
  return (
    <SectionCard
      eyebrow="Context"
      title="Current organization context"
      description="A quick read on who can act here and how this workspace fits into your broader organization access."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <SurfaceNote>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            Your role
          </p>
          <div className="mt-3 inline-flex">
            <RoleBadge role={detail.viewerRole} />
          </div>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            {detail.viewerRole === "operator"
              ? "You can review membership, invitations, and postings, but managers handle changes."
              : detail.viewerRole === "manager"
                ? "You can invite operators, manage postings, and review activity."
                : "You control the full organization profile, team access, and activity history."}
          </p>
        </SurfaceNote>
        <SurfaceNote>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            Memberships
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
            {membershipCount}
          </p>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Switch between organizations from the header without losing your
            place in this workspace.
          </p>
        </SurfaceNote>
        <SurfaceNote>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            Created
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
            {formatDate(detail.organization.createdAt)}
          </p>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Keep brand details current so renters recognize this organization
            across listings and booking flows.
          </p>
        </SurfaceNote>
      </div>
    </SectionCard>
  );
}

function OrganizationPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-[linear-gradient(180deg,#fbfbfa,#f5f7fb)] dark:bg-[linear-gradient(180deg,#020617,#0b1120)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(37,99,235,0.08),transparent_30%),radial-gradient(circle_at_88%_4%,rgba(212,168,95,0.12),transparent_28%)]"
      />
      <div className="relative mx-auto min-w-0 max-w-6xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        {children}
      </div>
    </main>
  );
}

interface OrganizationEmptyStateProps {
  name: string;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  saving: boolean;
  errorTitle: string | null;
  error: string | null;
  profile: ProfileFormValue;
  onProfileChange: (next: ProfileFormValue) => void;
  onProfileError: (message: string) => void;
}

function OrganizationEmptyState({
  name,
  onNameChange,
  onSubmit,
  saving,
  errorTitle,
  error,
  profile,
  onProfileChange,
  onProfileError,
}: OrganizationEmptyStateProps) {
  return (
    <OrganizationPageShell>
      <div className="mx-auto max-w-2xl rounded-[1.8rem] border border-slate-200 bg-white p-8 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.35)] sm:p-10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
        <Eyebrow>Organizations</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
          Create your first organization
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
          Start an organization to invite teammates, manage roles, and switch
          between shared workspaces. You will become its primary manager, and it
          becomes your active organization right away. You can also join one
          later when an existing organization invites you.
        </p>

        {error ? (
          <div className="mt-6">
            <FormErrorMessage title={errorTitle ?? undefined} message={error} />
          </div>
        ) : null}

        <div className="mt-7">
          <OrganizationCreateForm
            name={name}
            onNameChange={onNameChange}
            onSubmit={onSubmit}
            saving={saving}
            submitLabel="Create organization"
            profile={profile}
            onProfileChange={onProfileChange}
            onProfileError={onProfileError}
          />
        </div>
      </div>
    </OrganizationPageShell>
  );
}
function OrganizationWorkspaceHeader({
  detail,
  workspace,
  selectedOrganizationId,
  saving,
  showCreatePanel,
  onSelectOrganization,
  onToggleCreatePanel,
  createForm,
  memberCount,
  inviteCount,
  postingsTotal,
  postingsLoading,
}: {
  detail: OrganizationDetailResult | null;
  workspace: OrganizationWorkspaceResult;
  selectedOrganizationId: string | null;
  saving: boolean;
  showCreatePanel: boolean;
  onSelectOrganization: (organizationId: string) => void;
  onToggleCreatePanel: () => void;
  createForm: ReactNode;
  memberCount: number;
  inviteCount: number;
  postingsTotal: number;
  postingsLoading: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_70px_-40px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
      <div className="border-b border-slate-200/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(247,241,231,0.96))] p-6 sm:p-8 dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.96))]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <Eyebrow>Organization workspace</Eyebrow>
            <div className="mt-4 flex items-center gap-4">
              {detail?.organization.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={detail.organization.logoUrl}
                  alt={`${detail.organization.name} logo`}
                  className="h-14 w-14 shrink-0 rounded-2xl object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                />
              ) : null}
              <div className="min-w-0">
                <h1 className="truncate text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl dark:text-white">
                  {detail?.organization.name ?? "Organization"}
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Keep teammates, listings, and organization changes organized
                  in clearer sections instead of one long management page.
                </p>
              </div>
            </div>
            {detail ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  Your role: <RoleBadge role={detail.viewerRole} />
                </span>
                <span className="hidden h-1 w-1 rounded-full bg-slate-300 sm:inline-block dark:bg-slate-600" />
                <span>Created {formatDate(detail.organization.createdAt)}</span>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Active organization
              </span>
              <select
                value={selectedOrganizationId ?? ""}
                onChange={(event) => onSelectOrganization(event.target.value)}
                disabled={saving}
                className={`${inputClass} min-w-[16rem] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {workspace.memberships.map((membership) => (
                  <option key={membership.membershipId} value={membership.id}>
                    {membership.name} - {formatRole(membership.role)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={onToggleCreatePanel}
              className={`${secondaryButtonClass} h-11`}
            >
              {showCreatePanel ? "Close" : "New organization"}
            </button>
          </div>
        </div>

        {showCreatePanel ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white/75 p-4 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Create another organization
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              You will become its primary manager and it becomes your active
              workspace.
            </p>
            <div className="mt-3">{createForm}</div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 p-6 sm:grid-cols-2 sm:p-8 lg:grid-cols-4">
        <StatTile
          eyebrow="Members"
          value={memberCount}
          detail={memberCount === 1 ? "1 teammate" : `${memberCount} teammates`}
          accent="from-slate-700 to-slate-950 dark:from-slate-100 dark:to-slate-300"
        />
        <StatTile
          eyebrow="Postings"
          value={postingsLoading ? "..." : postingsTotal}
          detail={
            postingsTotal === 1 ? "1 listing" : `${postingsTotal} listings`
          }
          accent="from-emerald-500 to-teal-500"
        />
        <StatTile
          eyebrow="Pending invites"
          value={inviteCount}
          detail={
            inviteCount === 0 ? "No invites awaiting" : "Awaiting acceptance"
          }
          accent="from-amber-400 to-orange-500"
        />
        <StatTile
          eyebrow="Your access"
          value={
            <span className="text-xl">
              {detail ? formatRole(detail.viewerRole) : "-"}
            </span>
          }
          detail={
            detail?.viewerRole === "operator"
              ? "Review-only workspace access"
              : "Can manage team workflows"
          }
          accent="from-sky-500 to-cyan-500"
        />
      </div>
    </section>
  );
}

function OrganizationTabsBar({
  activeTab,
  allowedTabs,
  onChange,
  memberCount,
  postingsTotal,
  inviteCount,
  auditCount,
}: {
  activeTab: WorkspaceTab;
  allowedTabs: WorkspaceTab[];
  onChange: (tab: WorkspaceTab) => void;
  memberCount: number;
  postingsTotal: number;
  inviteCount: number;
  auditCount: number;
}) {
  const visibleTabs = WORKSPACE_TAB_DEFINITIONS.filter((tab) =>
    allowedTabs.includes(tab.id),
  );
  const tabRefs = useRef<
    Partial<Record<WorkspaceTab, HTMLButtonElement | null>>
  >({});

  useEffect(() => {
    const activeTabNode = tabRefs.current[activeTab];
    if (
      activeTabNode &&
      "scrollIntoView" in activeTabNode &&
      typeof activeTabNode.scrollIntoView === "function"
    ) {
      activeTabNode.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [activeTab]);

  function getTabMeta(tab: WorkspaceTab): string | null {
    if (tab === "team") {
      return `${memberCount} members / ${inviteCount} pending`;
    }
    if (tab === "postings") {
      return `${postingsTotal} listings`;
    }
    if (tab === "activity") {
      return `${auditCount} recent`;
    }
    if (tab === "settings") {
      return "Primary manager";
    }
    return null;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== "ArrowRight" &&
      event.key !== "ArrowLeft" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    event.preventDefault();
    const currentIndex = visibleTabs.findIndex((tab) => tab.id === activeTab);
    if (currentIndex === -1) {
      return;
    }

    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % visibleTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = visibleTabs.length - 1;
    }

    const nextTab = visibleTabs[nextIndex]?.id;
    if (!nextTab) {
      return;
    }

    onChange(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  return (
    <section className="sticky top-20 z-20 w-full min-w-0 max-w-full overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white/90 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.35)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-black/30">
      <div className="overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div
          role="tablist"
          aria-label="Organization workspace sections"
          onKeyDown={handleKeyDown}
          className="flex min-w-max gap-2 p-2 lg:grid lg:min-w-0 lg:w-full"
          style={{
            gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))`,
          }}
        >
          {visibleTabs.map((tab) => {
            const selected = tab.id === activeTab;
            const meta = getTabMeta(tab.id);
            return (
              <button
                key={tab.id}
                id={tabButtonId(tab.id)}
                ref={(node) => {
                  tabRefs.current[tab.id] = node;
                }}
                type="button"
                role="tab"
                tabIndex={selected ? 0 : -1}
                aria-selected={selected}
                aria-controls={tabPanelId(tab.id)}
                onClick={() => onChange(tab.id)}
                className={`flex w-[13rem] shrink-0 flex-col rounded-[1.1rem] px-4 py-3 text-left transition lg:w-auto lg:min-w-0 ${
                  selected
                    ? "bg-slate-950 text-white shadow-[0_16px_40px_-26px_rgba(15,23,42,0.75)] dark:bg-white dark:text-slate-950"
                    : "bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-white"
                }`}
              >
                <span className="text-sm font-semibold">{tab.label}</span>
                <span
                  className={`mt-1 text-xs leading-5 ${
                    selected
                      ? "text-slate-200 dark:text-slate-600"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {tab.description}
                </span>
                {meta ? (
                  <span
                    className={`mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                      selected
                        ? "text-slate-300 dark:text-slate-500"
                        : "text-slate-400 dark:text-slate-500"
                    }`}
                  >
                    {meta}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
function OverviewPanel({
  detail,
  membershipCount,
  memberCount,
  inviteCount,
  postingsTotal,
  auditCount,
  canSeeActivity,
  canEditSettings,
  onOpenTab,
}: {
  detail: OrganizationDetailResult;
  membershipCount: number;
  memberCount: number;
  inviteCount: number;
  postingsTotal: number;
  auditCount: number;
  canSeeActivity: boolean;
  canEditSettings: boolean;
  onOpenTab: (tab: WorkspaceTab) => void;
}) {
  const quickActions: Array<{
    tab: WorkspaceTab;
    eyebrow: string;
    title: string;
    description: string;
    meta: string;
  }> = [
    {
      tab: "team",
      eyebrow: "Team",
      title: isInviteCapable(detail.viewerRole)
        ? "Manage teammates and invites"
        : "Review teammates and invites",
      description:
        detail.viewerRole === "operator"
          ? "See who belongs to this organization and which invitations are still pending."
          : "Send new invites, review pending access, and keep member roles tidy.",
      meta: `${memberCount} members / ${inviteCount} pending`,
    },
    {
      tab: "postings",
      eyebrow: "Postings",
      title: "Check listing readiness",
      description:
        detail.viewerRole === "operator"
          ? "Review the current listings that belong to this organization."
          : "Create new listings, update status, and jump into editing from one panel.",
      meta: `${postingsTotal} listings`,
    },
  ];

  if (canSeeActivity) {
    quickActions.push({
      tab: "activity",
      eyebrow: "Activity",
      title: "Review recent changes",
      description:
        "Track manager actions, posting changes, and restorable versions without scrolling past every other surface.",
      meta: `${auditCount} recent entries`,
    });
  }

  if (canEditSettings) {
    quickActions.push({
      tab: "settings",
      eyebrow: "Settings",
      title: "Refresh organization details",
      description:
        "Update branding, contact information, and renter-facing details from a dedicated editor.",
      meta: "Primary manager controls",
    });
  }

  return (
    <div className="space-y-6">
      <SectionCard
        eyebrow="Overview"
        title="Jump to the work that matters"
        description="This page now keeps each management surface in its own section, so the fastest next step is always close at hand."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {quickActions.map((action) => (
            <WorkspaceQuickActionCard
              key={action.tab}
              eyebrow={action.eyebrow}
              title={action.title}
              description={action.description}
              meta={action.meta}
              onClick={() => onOpenTab(action.tab)}
            />
          ))}
        </div>
      </SectionCard>

      <OrganizationBasicsCard
        detail={detail}
        membershipCount={membershipCount}
      />

      <OrganizationAboutCard organization={detail.organization} />
    </div>
  );
}
function PostingsPanel({
  canManagePostings,
  postingsLoading,
  postingsError,
  postings,
  postingsTotal,
  saving,
  onPostingLifecycle,
}: {
  canManagePostings: boolean;
  postingsLoading: boolean;
  postingsError: string | null;
  postings: PostingRecord[];
  postingsTotal: number;
  saving: boolean;
  onPostingLifecycle: (
    postingId: string,
    action: PostingLifecycleAction,
  ) => void;
}) {
  return (
    <SectionCard
      eyebrow="Postings"
      title="Organization postings"
      description={
        canManagePostings
          ? `A preview of this organization's ${postingsTotal === 1 ? "listing" : "listings"}. Create new ones or jump straight into editing.`
          : "A preview of the listings owned by this organization."
      }
      action={
        canManagePostings ? (
          <Link href="/postings/create" className={primaryButtonClass}>
            Create posting
          </Link>
        ) : (
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {postingsTotal} total
          </span>
        )
      }
    >
      {postingsLoading ? (
        <div className="space-y-3">
          {[0, 1].map((key) => (
            <div
              key={key}
              className="h-[4.5rem] animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/70"
            />
          ))}
        </div>
      ) : postingsError ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {postingsError}
        </div>
      ) : postings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center dark:border-slate-700">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            No postings yet
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {canManagePostings
              ? "Create the first listing for this organization."
              : "Managers haven't created any listings yet."}
          </p>
          {canManagePostings ? (
            <Link
              href="/postings/create"
              className={`${primaryButtonClass} mt-4`}
            >
              Create posting
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {postings.map((posting) => (
            <div
              key={posting.id}
              className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-950/40"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold text-slate-950 dark:text-white">
                    {posting.name}
                  </p>
                  <PostingStatusBadge status={posting.status} />
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {formatPostingVariant(posting)} / {posting.location.city},{" "}
                  {posting.location.region}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canManagePostings
                  ? postingLifecycleActions(posting.status).map((lifecycle) => (
                      <button
                        key={lifecycle.id}
                        type="button"
                        onClick={() =>
                          onPostingLifecycle(posting.id, lifecycle.id)
                        }
                        disabled={saving}
                        className={
                          lifecycle.tone === "primary"
                            ? rowActionPrimaryClass
                            : rowActionMutedClass
                        }
                      >
                        {lifecycle.label}
                      </button>
                    ))
                  : null}
                <Link
                  href={`/postings/create?posting=${encodeURIComponent(posting.id)}`}
                  className={rowActionMutedClass}
                >
                  {canManagePostings ? "Edit" : "View"}
                </Link>
              </div>
            </div>
          ))}

          {postingsTotal > postings.length ? (
            <Link
              href="/postings/create"
              className="flex items-center justify-center rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-50/50 dark:border-slate-700 dark:text-sky-300 dark:hover:border-sky-900/60 dark:hover:bg-sky-950/20"
            >
              View all {postingsTotal} postings
            </Link>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

function TeamPanel({
  detail,
  inviteCount,
  memberCount,
  inviteEmail,
  inviteRole,
  saving,
  onInviteEmailChange,
  onInviteRoleChange,
  onInvite,
  onRevokeInvite,
  onUpdateMemberRole,
  onRemoveMember,
}: {
  detail: OrganizationDetailResult;
  inviteCount: number;
  memberCount: number;
  inviteEmail: string;
  inviteRole: CreateOrganizationInviteInput["role"];
  saving: boolean;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (role: CreateOrganizationInviteInput["role"]) => void;
  onInvite: () => void;
  onRevokeInvite: (inviteId: string) => void;
  onUpdateMemberRole: (
    memberId: string,
    role: Exclude<OrganizationRole, "primary_manager">,
  ) => void;
  onRemoveMember: (memberId: string) => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
      <SectionCard
        eyebrow="Invitations"
        title="Invite teammates"
        description={
          isInviteCapable(detail.viewerRole)
            ? "Send an email invite and choose the role they will join with."
            : "Operators can review pending invitations here, but only managers can send them."
        }
        action={
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {inviteCount} pending
          </span>
        }
      >
        {isInviteCapable(detail.viewerRole) ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onInvite();
            }}
            className="grid gap-3 md:grid-cols-[1.4fr_0.8fr_auto]"
          >
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => onInviteEmailChange(event.target.value)}
              placeholder="teammate@example.com"
              aria-label="Invite email address"
              className={inputClass}
            />
            <select
              value={inviteRole}
              onChange={(event) =>
                onInviteRoleChange(
                  event.target.value as CreateOrganizationInviteInput["role"],
                )
              }
              aria-label="Invite role"
              className={`${inputClass} cursor-pointer`}
            >
              {detail.viewerRole === "primary_manager" ? (
                <option value="manager">Manager</option>
              ) : null}
              <option value="operator">Operator</option>
            </select>
            <button
              type="submit"
              disabled={saving || inviteEmail.trim().length === 0}
              className={primaryButtonClass}
            >
              {saving ? "Sending..." : "Send invite"}
            </button>
          </form>
        ) : (
          <SurfaceNote>
            Operators can review pending invitations here, but only managers can
            send them.
          </SurfaceNote>
        )}

        <div className="mt-5 space-y-3">
          {detail.invitations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              No pending invitations.
            </div>
          ) : (
            detail.invitations.map((invite) => (
              <div
                key={invite.id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-semibold text-slate-950 dark:text-white">
                      {invite.email}
                    </p>
                    <RoleBadge role={invite.role} />
                    <InviteStatusBadge status={invite.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Invited by {invite.invitedBy.username} / Expires{" "}
                    {formatDate(invite.expiresAt)}
                  </p>
                </div>

                {detail.viewerRole !== "operator" ? (
                  <button
                    type="button"
                    onClick={() => onRevokeInvite(invite.id)}
                    disabled={saving}
                    className={secondaryButtonClass}
                  >
                    Revoke
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Members"
        title="Team roster"
        description="Manage who belongs to this organization and the access they hold."
        action={
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </span>
        }
      >
        <div className="space-y-3">
          {detail.members.map((member) => {
            const canPrimaryManagerEdit =
              detail.viewerRole === "primary_manager" &&
              member.role !== "primary_manager";
            const canManagerRemove =
              detail.viewerRole === "manager" && member.role === "operator";
            const displayName = member.username || member.email;

            return (
              <div
                key={member.membershipId}
                className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={displayName} imageUrl={member.avatarUrl} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-950 dark:text-white">
                      {displayName}
                    </p>
                    <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                      {member.email}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                      Joined {formatDate(member.joinedAt)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 lg:justify-end">
                  {canPrimaryManagerEdit ? (
                    <select
                      value={member.role}
                      onChange={(event) =>
                        onUpdateMemberRole(
                          member.membershipId,
                          event.target.value as Exclude<
                            OrganizationRole,
                            "primary_manager"
                          >,
                        )
                      }
                      disabled={saving}
                      aria-label={`Role for ${displayName}`}
                      className={`${inputClass} h-10 w-40 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <option value="manager">Manager</option>
                      <option value="operator">Operator</option>
                    </select>
                  ) : (
                    <RoleBadge role={member.role} />
                  )}

                  {canPrimaryManagerEdit || canManagerRemove ? (
                    <button
                      type="button"
                      onClick={() => onRemoveMember(member.membershipId)}
                      disabled={saving}
                      className={dangerButtonClass}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}

function ActivityPanel({
  auditLogs,
  auditLoading,
  auditError,
  restoringAuditId,
  onRestoreAudit,
}: {
  auditLogs: OrganizationAuditRecord[];
  auditLoading: boolean;
  auditError: string | null;
  restoringAuditId: string | null;
  onRestoreAudit: (auditId: string) => void;
}) {
  return (
    <div className="space-y-6">
      <SectionCard
        eyebrow="Audit trail"
        title="Recent organization activity"
        description="Review manager actions, posting changes, and restorable versions."
        action={
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {auditLogs.length} recent
          </span>
        }
      >
        {auditLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-20 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/70"
              />
            ))}
          </div>
        ) : auditError ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {auditError}
          </div>
        ) : auditLogs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No audited activity yet.
          </div>
        ) : (
          <div className="space-y-3">
            {auditLogs.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-4 lg:flex-row lg:items-start lg:justify-between dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-950 dark:text-white">
                      {formatAuditAction(entry.action)}
                    </p>
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      {entry.resourceType.replaceAll("_", " ")}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      v{entry.organizationVersion}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {entry.summary}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {entry.actor?.username ?? "System"} /{" "}
                    {formatDateTime(entry.createdAt)}
                  </p>
                  {entry.changes.length > 0 ? (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      Changed{" "}
                      {entry.changes
                        .slice(0, 4)
                        .map((change) => change.field)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
                {entry.restorable ? (
                  <button
                    type="button"
                    onClick={() => onRestoreAudit(entry.id)}
                    disabled={restoringAuditId === entry.id}
                    className={secondaryButtonClass}
                  >
                    {restoringAuditId === entry.id ? "Restoring..." : "Restore"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <section className="rounded-[1.8rem] border border-amber-200 bg-[linear-gradient(135deg,rgba(247,241,231,0.92),rgba(255,255,255,0.98))] p-6 sm:p-7 dark:border-amber-900/50 dark:bg-[linear-gradient(135deg,rgba(69,52,28,0.36),rgba(15,23,42,0.9))]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
              Analytics and payouts
            </p>
            <h2 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">
              Track performance in the owner dashboard
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Postings are managed here per organization. Performance analytics
              and payout ownership still live in the owner dashboard for now.
            </p>
          </div>
          <Link href="/dashboard" className={`${primaryButtonClass} shrink-0`}>
            Open owner dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}

function SettingsPanel({
  organizationName,
  profileForm,
  saving,
  onOrganizationNameChange,
  onProfileChange,
  onProfileError,
  onSubmit,
}: {
  organizationName: string;
  profileForm: ProfileFormValue;
  saving: boolean;
  onOrganizationNameChange: (value: string) => void;
  onProfileChange: (value: ProfileFormValue) => void;
  onProfileError: (message: string) => void;
  onSubmit: () => void;
}) {
  return (
    <SectionCard
      eyebrow="Settings"
      title="Organization profile"
      description="Only the primary manager can edit these details. They help renters recognize and reach your organization."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="grid gap-5"
      >
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Name</span>
          <input
            value={organizationName}
            onChange={(event) => onOrganizationNameChange(event.target.value)}
            aria-label="Rename organization"
            maxLength={160}
            className={inputClass}
          />
        </label>
        <OrganizationProfileFieldset
          value={profileForm}
          onChange={onProfileChange}
          onError={onProfileError}
          disabled={saving}
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || organizationName.trim().length === 0}
            className={primaryButtonClass}
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}
export function OrganizationWorkspace() {
  const pathname = usePathname() || "/dashboard/organizations";
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const rawTab = searchParams.get("tab");
  const { status, session, setSession } = useAuth();
  const { showError } = useErrorToast();
  const [workspace, setWorkspace] =
    useState<OrganizationWorkspaceResult | null>(null);
  const [detail, setDetail] = useState<OrganizationDetailResult | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorTitle, setErrorTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [newOrganizationName, setNewOrganizationName] = useState("");
  const [createProfile, setCreateProfile] =
    useState<ProfileFormValue>(emptyProfileForm());
  const [profileForm, setProfileForm] =
    useState<ProfileFormValue>(emptyProfileForm());
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<CreateOrganizationInviteInput["role"]>("operator");
  const [postings, setPostings] = useState<PostingRecord[]>([]);
  const [postingsTotal, setPostingsTotal] = useState(0);
  const [postingsLoading, setPostingsLoading] = useState(false);
  const [postingsError, setPostingsError] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<OrganizationAuditRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [restoringAuditId, setRestoringAuditId] = useState<string | null>(null);
  const [pendingTab, setPendingTab] = useState<WorkspaceTab | null>(null);
  const stagedLogoBlobNamesRef = useRef<Set<string>>(new Set());

  function showWorkspaceToast(title: string, body: string) {
    showError({
      title,
      message: body,
      tone: "error",
    });
  }

  function getWorkspaceActionError(
    nextError: unknown,
    action: string,
    fallback: string,
  ) {
    return getApiErrorMessage(nextError, {
      action,
      fallback,
      preserveClientMessage: true,
    });
  }

  function syncStagedLogoBlobStorage() {
    if (!session?.user.id) {
      return;
    }

    writeStagedOrganizationLogoBlobNames(
      session.user.id,
      stagedLogoBlobNamesRef.current,
    );
  }

  function rememberStagedLogoBlob(blobName: string) {
    const normalizedBlobName = blobName.trim();

    if (!normalizedBlobName) {
      return;
    }

    stagedLogoBlobNamesRef.current.add(normalizedBlobName);
    syncStagedLogoBlobStorage();
  }

  function forgetStagedLogoBlob(blobName: string) {
    const normalizedBlobName = blobName.trim();

    if (!normalizedBlobName) {
      return;
    }

    stagedLogoBlobNamesRef.current.delete(normalizedBlobName);
    syncStagedLogoBlobStorage();
  }

  function isStagedLogoBlob(blobName: string) {
    const normalizedBlobName = blobName.trim();
    return (
      normalizedBlobName.length > 0 &&
      stagedLogoBlobNamesRef.current.has(normalizedBlobName)
    );
  }

  async function deleteStagedLogoBlob(blobName: string) {
    const normalizedBlobName = blobName.trim();

    if (!normalizedBlobName) {
      return;
    }

    try {
      await blobApi.deleteBlob(normalizedBlobName);
      forgetStagedLogoBlob(normalizedBlobName);
    } catch {
      syncStagedLogoBlobStorage();
    }
  }

  function reconcileStagedLogoBlobChange(
    previousValue: ProfileFormValue,
    nextValue: ProfileFormValue,
  ) {
    const previousBlobName = previousValue.logoBlobName.trim();
    const nextBlobName = nextValue.logoBlobName.trim();

    if (nextBlobName && nextBlobName !== previousBlobName) {
      rememberStagedLogoBlob(nextBlobName);
    }

    if (
      previousBlobName &&
      previousBlobName !== nextBlobName &&
      isStagedLogoBlob(previousBlobName)
    ) {
      void deleteStagedLogoBlob(previousBlobName);
    }
  }

  function handleCreateProfileChange(nextValue: ProfileFormValue) {
    reconcileStagedLogoBlobChange(createProfile, nextValue);
    setCreateProfile(nextValue);
  }

  function handleProfileFormChange(nextValue: ProfileFormValue) {
    reconcileStagedLogoBlobChange(profileForm, nextValue);
    setProfileForm(nextValue);
  }

  function replaceTab(nextTab: WorkspaceTab) {
    const params = new URLSearchParams(searchParamsString);
    params.set("tab", nextTab);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  useEffect(() => {
    if (status !== "authenticated" || !session?.user.id) {
      stagedLogoBlobNamesRef.current.clear();
      return;
    }

    const stagedBlobNames = readStagedOrganizationLogoBlobNames(
      session.user.id,
    );
    stagedLogoBlobNamesRef.current = new Set(stagedBlobNames);

    if (stagedBlobNames.length === 0) {
      return;
    }

    void Promise.allSettled(
      stagedBlobNames.map(async (blobName) => {
        try {
          await blobApi.deleteBlob(blobName);
          forgetStagedLogoBlob(blobName);
        } catch {
          syncStagedLogoBlobStorage();
        }
      }),
    );
  }, [session?.user.id, status]);

  useEffect(() => {
    if (status !== "authenticated" || !session) {
      return;
    }

    function flushStagedLogoBlobs() {
      for (const blobName of stagedLogoBlobNamesRef.current) {
        blobApi.deleteBlobKeepalive(blobName);
      }
    }

    window.addEventListener("pagehide", flushStagedLogoBlobs);

    return () => {
      window.removeEventListener("pagehide", flushStagedLogoBlobs);
      flushStagedLogoBlobs();
    };
  }, [session, status]);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login?next=/dashboard/organizations");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    let active = true;

    async function loadWorkspace() {
      setLoading(true);
      setErrorTitle(null);
      setError(null);

      try {
        const nextWorkspace = await organizationsApi.getMine();

        if (!active) {
          return;
        }

        const nextOrganizationId =
          nextWorkspace.activeOrganization?.id ??
          nextWorkspace.memberships[0]?.id ??
          null;
        const nextDetail = nextOrganizationId
          ? await organizationsApi.getWorkspaceById(nextOrganizationId)
          : null;

        if (!active) {
          return;
        }

        startTransition(() => {
          setWorkspace(nextWorkspace);
          setSelectedOrganizationId(nextOrganizationId);
          setDetail(nextDetail);
          setOrganizationName(nextDetail?.organization.name ?? "");
          setProfileForm(
            nextDetail
              ? profileFormFromDetail(nextDetail.organization)
              : emptyProfileForm(),
          );
        });
      } catch (nextError) {
        if (active) {
          setErrorTitle("Couldn't load organization workspace");
          setError(
            getApiErrorMessage(nextError, {
              action: "load your organization workspace",
              fallback:
                "We couldn't load your organization workspace right now. Please try again.",
            }),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadWorkspace();

    return () => {
      active = false;
    };
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" || !selectedOrganizationId) {
      return;
    }

    let active = true;

    async function loadPostings() {
      setPostingsLoading(true);
      setPostingsError(null);

      try {
        const result = await postingsApi.listMine({
          pageSize: POSTINGS_PREVIEW_LIMIT,
        });

        if (!active) {
          return;
        }

        startTransition(() => {
          setPostings(result.postings);
          setPostingsTotal(result.pagination?.total ?? result.postings.length);
        });
      } catch (nextError) {
        if (active) {
          setPostings([]);
          setPostingsTotal(0);
          setPostingsError(
            getApiErrorMessage(nextError, {
              action: "load this organization's postings",
              fallback:
                "We couldn't load postings for this organization right now.",
            }),
          );
        }
      } finally {
        if (active) {
          setPostingsLoading(false);
        }
      }
    }

    void loadPostings();

    return () => {
      active = false;
    };
  }, [selectedOrganizationId, status]);

  useEffect(() => {
    if (
      status !== "authenticated" ||
      !selectedOrganizationId ||
      detail?.viewerRole === "operator"
    ) {
      setAuditLogs([]);
      return;
    }

    let active = true;

    async function loadAudit() {
      setAuditLoading(true);
      setAuditError(null);

      try {
        const result = await organizationsApi.listAudit(
          selectedOrganizationId!,
        );

        if (!active) {
          return;
        }

        startTransition(() => {
          setAuditLogs(result.auditLogs);
        });
      } catch (nextError) {
        if (active) {
          setAuditLogs([]);
          setAuditError(
            getApiErrorMessage(nextError, {
              action: "load organization audit history",
              fallback:
                "We couldn't load this organization's audit history right now.",
            }),
          );
        }
      } finally {
        if (active) {
          setAuditLoading(false);
        }
      }
    }

    void loadAudit();

    return () => {
      active = false;
    };
  }, [detail?.viewerRole, selectedOrganizationId, status]);

  async function refresh(selectedId = selectedOrganizationId) {
    const nextWorkspace = await organizationsApi.getMine();
    const resolvedOrganizationId =
      selectedId ??
      nextWorkspace.activeOrganization?.id ??
      nextWorkspace.memberships[0]?.id ??
      null;
    const nextDetail = resolvedOrganizationId
      ? await organizationsApi.getWorkspaceById(resolvedOrganizationId)
      : null;

    startTransition(() => {
      setWorkspace(nextWorkspace);
      setSelectedOrganizationId(resolvedOrganizationId);
      setDetail(nextDetail);
      setOrganizationName(nextDetail?.organization.name ?? "");
      setProfileForm(
        nextDetail
          ? profileFormFromDetail(nextDetail.organization)
          : emptyProfileForm(),
      );
    });
  }

  async function handleCreate() {
    const trimmedName = newOrganizationName.trim();

    if (trimmedName.length === 0) {
      return;
    }

    const submittedLogoBlobName = createProfile.logoBlobName.trim();

    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      const result = await organizationsApi.create({
        name: trimmedName,
        ...profileFormToInput(createProfile),
      });

      forgetStagedLogoBlob(submittedLogoBlobName);

      const refreshedSession = await authApi.refresh();

      if (refreshedSession) {
        setSession(refreshedSession);
      }

      await refresh(result.organization.id);
      setNewOrganizationName("");
      setCreateProfile(emptyProfileForm());
      setShowCreatePanel(false);
      setMessage(`${result.organization.name} created.`);
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "create that organization",
        "We couldn't create that organization right now. Please try again.",
      );
      setErrorTitle("Couldn't create organization");
      setError(nextMessage);
      showWorkspaceToast("Couldn't create organization", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handleSelectOrganization(organizationId: string) {
    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.setActive({ organizationId });

      const refreshedSession = await authApi.refresh();

      if (refreshedSession) {
        setSession(refreshedSession);
      }

      await refresh(organizationId);
      setMessage("Active organization updated.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "switch your active organization",
        "We couldn't switch your active organization right now. Please try again.",
      );
      setErrorTitle("Couldn't switch organizations");
      setError(nextMessage);
      showWorkspaceToast("Couldn't switch organizations", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveProfile() {
    if (!detail) {
      return;
    }

    const submittedLogoBlobName = profileForm.logoBlobName.trim();

    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.update(detail.organization.id, {
        name: organizationName,
        ...profileFormToInput(profileForm),
      });
      forgetStagedLogoBlob(submittedLogoBlobName);
      await refresh(detail.organization.id);
      setMessage("Organization profile updated.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "update this organization",
        "We couldn't update this organization right now. Please try again.",
      );
      setErrorTitle("Couldn't update organization");
      setError(nextMessage);
      showWorkspaceToast("Couldn't update organization", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handleInvite() {
    if (!detail) {
      return;
    }

    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.createInvite(detail.organization.id, {
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      });
      await refresh(detail.organization.id);
      setInviteEmail("");
      setInviteRole(detail.viewerRole === "manager" ? "operator" : inviteRole);
      setMessage("Invitation sent.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "send that invitation",
        "We couldn't send that invitation right now. Please try again.",
      );
      setErrorTitle("Couldn't send invitation");
      setError(nextMessage);
      showWorkspaceToast("Couldn't send invitation", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!detail) {
      return;
    }

    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.revokeInvite(detail.organization.id, inviteId);
      await refresh(detail.organization.id);
      setMessage("Invitation revoked.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "revoke that invitation",
        "We couldn't revoke that invitation right now. Please try again.",
      );
      setErrorTitle("Couldn't revoke invitation");
      setError(nextMessage);
      showWorkspaceToast("Couldn't revoke invitation", nextMessage);
    } finally {
      setSaving(false);
    }
  }
  async function handleUpdateMemberRole(
    memberId: string,
    role: Exclude<OrganizationRole, "primary_manager">,
  ) {
    if (!detail) {
      return;
    }

    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.updateMemberRole(
        detail.organization.id,
        memberId,
        role,
      );
      await refresh(detail.organization.id);
      setMessage("Member role updated.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "update that member's role",
        "We couldn't update that member's role right now. Please try again.",
      );
      setErrorTitle("Couldn't update member role");
      setError(nextMessage);
      showWorkspaceToast("Couldn't update member role", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!detail) {
      return;
    }

    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.removeMember(detail.organization.id, memberId);
      await refresh(detail.organization.id);
      setMessage("Member removed.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "remove that member",
        "We couldn't remove that member right now. Please try again.",
      );
      setErrorTitle("Couldn't remove member");
      setError(nextMessage);
      showWorkspaceToast("Couldn't remove member", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handlePostingLifecycle(
    postingId: string,
    action: PostingLifecycleAction,
  ) {
    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      if (action === "publish") {
        await postingsApi.publish(postingId);
      } else if (action === "pause") {
        await postingsApi.pausePosting(postingId);
      } else if (action === "unpause") {
        await postingsApi.unpausePosting(postingId);
      } else {
        await postingsApi.archive(postingId);
      }

      const result = await postingsApi.listMine({
        pageSize: POSTINGS_PREVIEW_LIMIT,
      });
      startTransition(() => {
        setPostings(result.postings);
        setPostingsTotal(result.pagination?.total ?? result.postings.length);
      });

      const pastTense: Record<PostingLifecycleAction, string> = {
        publish: "published",
        pause: "paused",
        unpause: "unpaused",
        archive: "archived",
      };
      setMessage(`Posting ${pastTense[action]}.`);
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        `${action} that posting`,
        "We couldn't update that posting right now. Please try again.",
      );
      setErrorTitle("Couldn't update posting");
      setError(nextMessage);
      showWorkspaceToast("Couldn't update posting", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handleRestoreAudit(auditId: string) {
    if (!detail) {
      return;
    }

    setRestoringAuditId(auditId);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.restoreAuditEntry(detail.organization.id, auditId);
      await refresh(detail.organization.id);
      const [postingsResult, auditResult] = await Promise.all([
        postingsApi.listMine({ pageSize: POSTINGS_PREVIEW_LIMIT }),
        organizationsApi.listAudit(detail.organization.id),
      ]);
      startTransition(() => {
        setPostings(postingsResult.postings);
        setPostingsTotal(
          postingsResult.pagination?.total ?? postingsResult.postings.length,
        );
        setAuditLogs(auditResult.auditLogs);
      });
      setMessage("Version restored.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "restore that version",
        "We couldn't restore that version right now. Please try again.",
      );
      setErrorTitle("Couldn't restore version");
      setError(nextMessage);
      showWorkspaceToast("Couldn't restore version", nextMessage);
    } finally {
      setRestoringAuditId(null);
    }
  }

  const allowedTabs = getAllowedTabs(detail?.viewerRole);
  const resolvedTab = detail
    ? resolveWorkspaceTab(rawTab, allowedTabs)
    : isWorkspaceTab(rawTab)
      ? rawTab
      : "overview";
  const currentTab = pendingTab ?? resolvedTab;

  function handleTabChange(nextTab: WorkspaceTab) {
    if (nextTab === currentTab) {
      return;
    }

    setPendingTab(nextTab);
    replaceTab(nextTab);
  }

  useEffect(() => {
    setPendingTab(null);
  }, [resolvedTab]);

  useEffect(() => {
    if (!detail) {
      return;
    }

    if (rawTab === resolvedTab) {
      return;
    }

    if (!rawTab && resolvedTab === "overview") {
      return;
    }

    replaceTab(resolvedTab);
  }, [detail, pathname, rawTab, resolvedTab, searchParamsString]);

  if (status === "loading" || loading) {
    return (
      <OrganizationPageShell>
        <div className="space-y-6">
          <div className="h-48 animate-pulse rounded-[1.8rem] bg-slate-200/70 dark:bg-slate-800/70" />
          <div className="h-24 animate-pulse rounded-[1.5rem] bg-slate-200/70 dark:bg-slate-800/70" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((key) => (
              <div
                key={key}
                className="h-32 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/70"
              />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-[1.8rem] bg-slate-200/70 dark:bg-slate-800/70" />
        </div>
      </OrganizationPageShell>
    );
  }

  if (status !== "authenticated" || !session) {
    return null;
  }

  if (!workspace || workspace.memberships.length === 0) {
    return (
      <OrganizationEmptyState
        name={newOrganizationName}
        onNameChange={setNewOrganizationName}
        onSubmit={() => void handleCreate()}
        saving={saving}
        errorTitle={errorTitle}
        error={error}
        profile={createProfile}
        onProfileChange={handleCreateProfileChange}
        onProfileError={(nextMessage) =>
          showWorkspaceToast("Couldn't upload logo", nextMessage)
        }
      />
    );
  }

  const memberCount = detail?.members.length ?? 0;
  const inviteCount = detail?.invitations.length ?? 0;
  const canManagePostings = detail
    ? canManageOrganizationPostings({
        id: detail.organization.id,
        name: detail.organization.name,
        role: detail.viewerRole,
      })
    : false;
  const canSeeActivity = detail?.viewerRole !== "operator";
  const canEditSettings = detail?.viewerRole === "primary_manager";

  return (
    <OrganizationPageShell>
      <OrganizationWorkspaceHeader
        detail={detail}
        workspace={workspace}
        selectedOrganizationId={selectedOrganizationId}
        saving={saving}
        showCreatePanel={showCreatePanel}
        onSelectOrganization={(organizationId) =>
          void handleSelectOrganization(organizationId)
        }
        onToggleCreatePanel={() => setShowCreatePanel((value) => !value)}
        createForm={
          <OrganizationCreateForm
            name={newOrganizationName}
            onNameChange={setNewOrganizationName}
            onSubmit={() => void handleCreate()}
            saving={saving}
            submitLabel="Create organization"
            profile={createProfile}
            onProfileChange={handleCreateProfileChange}
            onProfileError={(nextMessage) =>
              showWorkspaceToast("Couldn't upload logo", nextMessage)
            }
          />
        }
        memberCount={memberCount}
        inviteCount={inviteCount}
        postingsTotal={postingsTotal}
        postingsLoading={postingsLoading}
      />

      {error ? (
        <FormErrorMessage title={errorTitle ?? undefined} message={error} />
      ) : null}

      {message ? (
        <div
          role="status"
          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          {message}
        </div>
      ) : null}

      {detail ? (
        <>
          <OrganizationTabsBar
            activeTab={currentTab}
            allowedTabs={allowedTabs}
            onChange={handleTabChange}
            memberCount={memberCount}
            postingsTotal={postingsTotal}
            inviteCount={inviteCount}
            auditCount={auditLogs.length}
          />

          <WorkspaceTabPanel tab="overview" activeTab={currentTab}>
            <OverviewPanel
              detail={detail}
              membershipCount={workspace.memberships.length}
              memberCount={memberCount}
              inviteCount={inviteCount}
              postingsTotal={postingsTotal}
              auditCount={auditLogs.length}
              canSeeActivity={canSeeActivity}
              canEditSettings={canEditSettings}
              onOpenTab={handleTabChange}
            />
          </WorkspaceTabPanel>

          <WorkspaceTabPanel tab="team" activeTab={currentTab}>
            <TeamPanel
              detail={detail}
              inviteCount={inviteCount}
              memberCount={memberCount}
              inviteEmail={inviteEmail}
              inviteRole={inviteRole}
              saving={saving}
              onInviteEmailChange={setInviteEmail}
              onInviteRoleChange={setInviteRole}
              onInvite={() => void handleInvite()}
              onRevokeInvite={(inviteId) => void handleRevokeInvite(inviteId)}
              onUpdateMemberRole={(memberId, role) =>
                void handleUpdateMemberRole(memberId, role)
              }
              onRemoveMember={(memberId) => void handleRemoveMember(memberId)}
            />
          </WorkspaceTabPanel>

          <WorkspaceTabPanel tab="postings" activeTab={currentTab}>
            <PostingsPanel
              canManagePostings={canManagePostings}
              postingsLoading={postingsLoading}
              postingsError={postingsError}
              postings={postings}
              postingsTotal={postingsTotal}
              saving={saving}
              onPostingLifecycle={(postingId, action) =>
                void handlePostingLifecycle(postingId, action)
              }
            />
          </WorkspaceTabPanel>

          {canSeeActivity ? (
            <WorkspaceTabPanel tab="activity" activeTab={currentTab}>
              <ActivityPanel
                auditLogs={auditLogs}
                auditLoading={auditLoading}
                auditError={auditError}
                restoringAuditId={restoringAuditId}
                onRestoreAudit={(auditId) => void handleRestoreAudit(auditId)}
              />
            </WorkspaceTabPanel>
          ) : null}

          {canEditSettings ? (
            <WorkspaceTabPanel tab="settings" activeTab={currentTab}>
              <SettingsPanel
                organizationName={organizationName}
                profileForm={profileForm}
                saving={saving}
                onOrganizationNameChange={setOrganizationName}
                onProfileChange={handleProfileFormChange}
                onProfileError={(nextMessage) =>
                  showWorkspaceToast("Couldn't upload logo", nextMessage)
                }
                onSubmit={() => void handleSaveProfile()}
              />
            </WorkspaceTabPanel>
          ) : null}
        </>
      ) : null}
    </OrganizationPageShell>
  );
}

