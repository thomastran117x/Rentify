"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { FormErrorMessage, useErrorToast } from "@/components/errors";
import { authApi } from "@/lib/auth/api";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { canManageOrganizationPostings } from "@/lib/auth/roles";
import {
  organizationsApi,
  type CreateOrganizationInviteInput,
  type OrganizationDetailResult,
  type OrganizationInviteStatus,
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
  "inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300";

const rowActionPrimaryClass =
  "inline-flex h-9 items-center justify-center rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50";

const POSTINGS_PREVIEW_LIMIT = 5;

const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition duration-200 placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-500/20";

const primaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-md hover:shadow-violet-600/25 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300";

const dangerButtonClass =
  "inline-flex h-10 items-center justify-center rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 transition duration-200 hover:-translate-y-0.5 hover:bg-rose-50 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/40";

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 shadow-sm dark:border-violet-900/60 dark:bg-slate-900 dark:text-violet-300">
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
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-sm font-semibold text-white ring-1 ring-white/20">
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_40px_-24px_rgba(15,23,42,0.25)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
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

interface OrganizationCreateFormProps {
  name: string;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  saving: boolean;
  submitLabel: string;
  placeholder?: string;
}

function OrganizationCreateForm({
  name,
  onNameChange,
  onSubmit,
  saving,
  submitLabel,
  placeholder = "Acme Rentals",
}: OrganizationCreateFormProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="grid gap-3 sm:grid-cols-[1fr_auto]"
    >
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
    </form>
  );
}

function OrganizationPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-slate-50 dark:bg-slate-950">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(124,58,237,0.10),transparent_32%),radial-gradient(circle_at_88%_4%,rgba(99,102,241,0.08),transparent_30%)]"
      />
      <div className="relative mx-auto max-w-6xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
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
}

function OrganizationEmptyState({
  name,
  onNameChange,
  onSubmit,
  saving,
  errorTitle,
  error,
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
          />
        </div>
      </div>
    </OrganizationPageShell>
  );
}

export function OrganizationWorkspace() {
  const router = useRouter();
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
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<CreateOrganizationInviteInput["role"]>("operator");
  const [postings, setPostings] = useState<PostingRecord[]>([]);
  const [postingsTotal, setPostingsTotal] = useState(0);
  const [postingsLoading, setPostingsLoading] = useState(false);
  const [postingsError, setPostingsError] = useState<string | null>(null);

  function showWorkspaceToast(title: string, message: string) {
    showError({
      title,
      message,
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

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login?next=/organizations");
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
          ? await organizationsApi.getById(nextOrganizationId)
          : null;

        if (!active) {
          return;
        }

        startTransition(() => {
          setWorkspace(nextWorkspace);
          setSelectedOrganizationId(nextOrganizationId);
          setDetail(nextDetail);
          setOrganizationName(nextDetail?.organization.name ?? "");
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

  // Postings follow the active organization on the backend. We refetch whenever
  // the selected (and therefore active) organization changes.
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
  }, [status, selectedOrganizationId]);

  async function refresh(selectedId = selectedOrganizationId) {
    const nextWorkspace = await organizationsApi.getMine();
    const resolvedOrganizationId =
      selectedId ??
      nextWorkspace.activeOrganization?.id ??
      nextWorkspace.memberships[0]?.id ??
      null;
    const nextDetail = resolvedOrganizationId
      ? await organizationsApi.getById(resolvedOrganizationId)
      : null;

    startTransition(() => {
      setWorkspace(nextWorkspace);
      setSelectedOrganizationId(resolvedOrganizationId);
      setDetail(nextDetail);
      setOrganizationName(nextDetail?.organization.name ?? "");
    });
  }

  async function handleCreate() {
    const trimmedName = newOrganizationName.trim();

    if (trimmedName.length === 0) {
      return;
    }

    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      const result = await organizationsApi.create({ name: trimmedName });

      const refreshedSession = await authApi.refresh();

      if (refreshedSession) {
        setSession(refreshedSession);
      }

      await refresh(result.organization.id);
      setNewOrganizationName("");
      setShowCreatePanel(false);
      setMessage(`${result.organization.name} created.`);
    } catch (nextError) {
      const message = getWorkspaceActionError(
        nextError,
        "create that organization",
        "We couldn't create that organization right now. Please try again.",
      );
      setErrorTitle("Couldn't create organization");
      setError(message);
      showWorkspaceToast("Couldn't create organization", message);
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
      const message = getWorkspaceActionError(
        nextError,
        "switch your active organization",
        "We couldn't switch your active organization right now. Please try again.",
      );
      setErrorTitle("Couldn't switch organizations");
      setError(message);
      showWorkspaceToast("Couldn't switch organizations", message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRename() {
    if (!detail) {
      return;
    }

    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.rename(detail.organization.id, organizationName);
      await refresh(detail.organization.id);
      setMessage("Organization name updated.");
    } catch (nextError) {
      const message = getWorkspaceActionError(
        nextError,
        "rename this organization",
        "We couldn't rename this organization right now. Please try again.",
      );
      setErrorTitle("Couldn't rename organization");
      setError(message);
      showWorkspaceToast("Couldn't rename organization", message);
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
      const message = getWorkspaceActionError(
        nextError,
        "send that invitation",
        "We couldn't send that invitation right now. Please try again.",
      );
      setErrorTitle("Couldn't send invitation");
      setError(message);
      showWorkspaceToast("Couldn't send invitation", message);
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
      const message = getWorkspaceActionError(
        nextError,
        "revoke that invitation",
        "We couldn't revoke that invitation right now. Please try again.",
      );
      setErrorTitle("Couldn't revoke invitation");
      setError(message);
      showWorkspaceToast("Couldn't revoke invitation", message);
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
      const message = getWorkspaceActionError(
        nextError,
        "update that member's role",
        "We couldn't update that member's role right now. Please try again.",
      );
      setErrorTitle("Couldn't update member role");
      setError(message);
      showWorkspaceToast("Couldn't update member role", message);
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
      const message = getWorkspaceActionError(
        nextError,
        "remove that member",
        "We couldn't remove that member right now. Please try again.",
      );
      setErrorTitle("Couldn't remove member");
      setError(message);
      showWorkspaceToast("Couldn't remove member", message);
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
      const message = getWorkspaceActionError(
        nextError,
        `${action} that posting`,
        "We couldn't update that posting right now. Please try again.",
      );
      setErrorTitle("Couldn't update posting");
      setError(message);
      showWorkspaceToast("Couldn't update posting", message);
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading" || loading) {
    return (
      <OrganizationPageShell>
        <div className="space-y-6">
          <div className="h-40 animate-pulse rounded-[1.8rem] bg-slate-200/70 dark:bg-slate-800/70" />
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

  return (
    <OrganizationPageShell>
      {/* Header / hero */}
      <section className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-[0_24px_70px_-40px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
        <div className="border-b border-slate-200/70 bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.10),transparent_36%),linear-gradient(180deg,#ffffff,#f8fafc)] p-6 sm:p-8 dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.16),transparent_36%),linear-gradient(180deg,#0f172a,#020617)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <Eyebrow>Organization workspace</Eyebrow>
              <h1 className="mt-4 truncate text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl dark:text-white">
                {detail?.organization.name ?? "Organization"}
              </h1>
              {detail ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    Your role: <RoleBadge role={detail.viewerRole} />
                  </span>
                  <span className="hidden h-1 w-1 rounded-full bg-slate-300 sm:inline-block dark:bg-slate-600" />
                  <span>
                    Created {formatDate(detail.organization.createdAt)}
                  </span>
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
                  onChange={(event) =>
                    void handleSelectOrganization(event.target.value)
                  }
                  disabled={saving}
                  className={`${inputClass} min-w-[16rem] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {workspace.memberships.map((membership) => (
                    <option key={membership.membershipId} value={membership.id}>
                      {membership.name} — {formatRole(membership.role)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setShowCreatePanel((value) => !value)}
                className={`${secondaryButtonClass} h-11`}
              >
                {showCreatePanel ? "Close" : "New organization"}
              </button>
            </div>
          </div>

          {showCreatePanel ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Create another organization
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                You will become its primary manager and it becomes your active
                workspace.
              </p>
              <div className="mt-3">
                <OrganizationCreateForm
                  name={newOrganizationName}
                  onNameChange={setNewOrganizationName}
                  onSubmit={() => void handleCreate()}
                  saving={saving}
                  submitLabel="Create organization"
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* Stat tiles */}
        <div className="grid gap-4 p-6 sm:grid-cols-2 sm:p-8 lg:grid-cols-4">
          <StatTile
            eyebrow="Members"
            value={memberCount}
            detail={
              memberCount === 1 ? "1 teammate" : `${memberCount} teammates`
            }
            accent="from-violet-500 to-indigo-500"
          />
          <StatTile
            eyebrow="Postings"
            value={postingsLoading ? "…" : postingsTotal}
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
                {detail ? formatRole(detail.viewerRole) : "—"}
              </span>
            }
            detail={
              detail?.viewerRole === "operator"
                ? "View-only management"
                : "Can manage the team"
            }
            accent="from-sky-500 to-cyan-500"
          />
        </div>
      </section>

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
                        {formatPostingVariant(posting)} ·{" "}
                        {posting.location.city}, {posting.location.region}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canManagePostings
                        ? postingLifecycleActions(posting.status).map(
                            (lifecycle) => (
                              <button
                                key={lifecycle.id}
                                type="button"
                                onClick={() =>
                                  void handlePostingLifecycle(
                                    posting.id,
                                    lifecycle.id,
                                  )
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
                            ),
                          )
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
                    className="flex items-center justify-center rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-50/50 dark:border-slate-700 dark:text-violet-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/30"
                  >
                    View all {postingsTotal} postings
                  </Link>
                ) : null}
              </div>
            )}
          </SectionCard>

          {detail.viewerRole === "primary_manager" ? (
            <SectionCard
              eyebrow="Settings"
              title="Organization name"
              description="Only the primary manager can rename this organization."
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleRename();
                }}
                className="grid gap-3 sm:grid-cols-[1fr_auto]"
              >
                <input
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  aria-label="Rename organization"
                  maxLength={160}
                  className={inputClass}
                />
                <button
                  type="submit"
                  disabled={saving || organizationName.trim().length === 0}
                  className={primaryButtonClass}
                >
                  {saving ? "Saving..." : "Save name"}
                </button>
              </form>
            </SectionCard>
          ) : null}

          <SectionCard
            eyebrow="Invitations"
            title="Invite teammates"
            description={
              isInviteCapable(detail.viewerRole)
                ? "Send an email invite and choose the role they will join with."
                : "Operators can review pending invitations, but only managers can send them."
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
                  void handleInvite();
                }}
                className="grid gap-3 md:grid-cols-[1.4fr_0.8fr_auto]"
              >
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="teammate@example.com"
                  aria-label="Invite email address"
                  className={inputClass}
                />
                <select
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(
                      event.target
                        .value as CreateOrganizationInviteInput["role"],
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
            ) : null}

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
                        Invited by {invite.invitedBy.username} · Expires{" "}
                        {formatDate(invite.expiresAt)}
                      </p>
                    </div>

                    {detail.viewerRole !== "operator" ? (
                      <button
                        type="button"
                        onClick={() => void handleRevokeInvite(invite.id)}
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
                            void handleUpdateMemberRole(
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
                          onClick={() =>
                            void handleRemoveMember(member.membershipId)
                          }
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

          <section className="rounded-[1.8rem] border border-violet-200 bg-violet-50/70 p-6 sm:p-7 dark:border-violet-900/50 dark:bg-violet-950/30">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
                  Analytics &amp; payouts
                </p>
                <h2 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">
                  Track performance in the owner dashboard
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Postings are managed here per organization. Performance
                  analytics and payout ownership still live in the owner
                  dashboard for now.
                </p>
              </div>
              <Link
                href="/dashboard"
                className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700"
              >
                Open owner dashboard
              </Link>
            </div>
          </section>
        </>
      ) : null}
    </OrganizationPageShell>
  );
}
