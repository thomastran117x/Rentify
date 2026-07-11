"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { FormErrorMessage, useErrorToast } from "@/components/errors";
import { authApi } from "@/lib/auth/api";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  organizationsApi,
  type CreateOrganizationInviteInput,
  type OrganizationDetailResult,
  type OrganizationRole,
  type OrganizationWorkspaceResult,
} from "@/lib/organizations/api";

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

function isInviteCapable(role?: OrganizationRole): boolean {
  return role === "primary_manager" || role === "manager";
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
      className="grid gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4 md:grid-cols-[1fr_auto]"
    >
      <input
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder={placeholder}
        aria-label="Organization name"
        maxLength={160}
        className="h-11 rounded-2xl border border-slate-300 dark:border-slate-700 px-4 text-slate-900 dark:text-white outline-none transition focus:border-slate-950 dark:focus:border-slate-400"
      />
      <button
        type="submit"
        disabled={saving || name.trim().length === 0}
        className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? "Creating..." : submitLabel}
      </button>
    </form>
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
    <main className="min-h-[calc(100vh-5.5rem)] bg-slate-50 dark:bg-slate-900 px-6 py-12 text-slate-900 dark:text-white">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            Organizations
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
            Create your first organization
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
            Start an organization to invite teammates, manage roles, and switch
            between shared workspaces. You will become its primary manager, and
            it will be set as your active organization right away. You can also
            join one later when an existing organization invites you.
          </p>

          {error ? (
            <div className="mt-6">
              <FormErrorMessage
                title={errorTitle ?? undefined}
                message={error}
              />
            </div>
          ) : null}

          <div className="mt-6">
            <OrganizationCreateForm
              name={name}
              onNameChange={onNameChange}
              onSubmit={onSubmit}
              saving={saving}
              submitLabel="Create organization"
            />
          </div>
        </div>
      </div>
    </main>
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
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<CreateOrganizationInviteInput["role"]>("operator");

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

  if (status === "loading" || loading) {
    return (
      <main className="min-h-[calc(100vh-5.5rem)] bg-slate-50 dark:bg-slate-900 px-6 py-12 text-slate-900 dark:text-white">
        <div className="mx-auto max-w-6xl text-sm font-medium text-slate-500 dark:text-slate-400">
          Loading organization workspace...
        </div>
      </main>
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

  return (
    <main className="min-h-[calc(100vh-5.5rem)] bg-[linear-gradient(180deg,_#f8fafc,_#ffffff)] dark:bg-[linear-gradient(180deg,_#020617,_#0b1120)] px-6 py-10 text-slate-900 dark:text-white">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-7 shadow-[0_24px_80px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                Organization workspace
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">
                Manage teammates before shared posting access rolls out
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
                This first release adds organization structure, invite
                management, and active-organization switching. Posting and
                payout ownership still follow the existing owner account model
                for now.
              </p>
            </div>

            <label className="grid gap-2 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Active organization
              </span>
              <select
                value={selectedOrganizationId ?? ""}
                onChange={(event) =>
                  void handleSelectOrganization(event.target.value)
                }
                disabled={saving}
                className="h-12 min-w-[18rem] rounded-2xl border border-slate-300 dark:border-slate-700 px-4 text-slate-900 dark:text-white outline-none transition focus:border-slate-950 dark:focus:border-slate-400"
              >
                {workspace.memberships.map((membership) => (
                  <option key={membership.membershipId} value={membership.id}>
                    {membership.name} - {formatRole(membership.role)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-md">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                  New organization
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Spin up another organization. You will become its primary
                  manager and it becomes your active workspace.
                </p>
              </div>
              <div className="w-full lg:max-w-md">
                <OrganizationCreateForm
                  name={newOrganizationName}
                  onNameChange={setNewOrganizationName}
                  onSubmit={() => void handleCreate()}
                  saving={saving}
                  submitLabel="Create"
                />
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <FormErrorMessage title={errorTitle ?? undefined} message={error} />
        ) : null}

        {message ? (
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 px-5 py-4 text-sm text-emerald-800 dark:text-emerald-300">
            {message}
          </div>
        ) : null}

        {detail ? (
          <>
            <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
              <div className="rounded-[1.8rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                      Organization
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                      {detail.organization.name}
                    </h2>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      Your role: {formatRole(detail.viewerRole)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 px-4 py-3 text-right text-sm text-slate-600 dark:text-slate-300">
                    <p>Created</p>
                    <p className="mt-1 font-semibold text-slate-900 dark:text-white">
                      {formatDate(detail.organization.createdAt)}
                    </p>
                  </div>
                </div>

                {detail.viewerRole === "primary_manager" ? (
                  <div className="mt-6 space-y-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4">
                    <label className="grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        Rename organization
                      </span>
                      <input
                        value={organizationName}
                        onChange={(event) =>
                          setOrganizationName(event.target.value)
                        }
                        className="h-11 rounded-2xl border border-slate-300 dark:border-slate-700 px-4 text-slate-900 dark:text-white outline-none transition focus:border-slate-950 dark:focus:border-slate-400"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleRename()}
                      disabled={saving || organizationName.trim().length === 0}
                      className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving ? "Saving..." : "Save name"}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="rounded-[1.8rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                      Invitations
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                      Invite teammates
                    </h2>
                  </div>
                  <div className="rounded-2xl bg-sky-50 dark:bg-sky-950/40 px-4 py-3 text-sm text-sky-800 dark:text-sky-300">
                    Pending invites: {detail.invitations.length}
                  </div>
                </div>

                {isInviteCapable(detail.viewerRole) ? (
                  <div className="mt-6 grid gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4 md:grid-cols-[1.2fr_0.7fr_auto]">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="teammate@example.com"
                      className="h-11 rounded-2xl border border-slate-300 dark:border-slate-700 px-4 text-slate-900 dark:text-white outline-none transition focus:border-slate-950 dark:focus:border-slate-400"
                    />
                    <select
                      value={inviteRole}
                      onChange={(event) =>
                        setInviteRole(
                          event.target
                            .value as CreateOrganizationInviteInput["role"],
                        )
                      }
                      className="h-11 rounded-2xl border border-slate-300 dark:border-slate-700 px-4 text-slate-900 dark:text-white outline-none transition focus:border-slate-950 dark:focus:border-slate-400"
                    >
                      {detail.viewerRole === "primary_manager" ? (
                        <option value="manager">Manager</option>
                      ) : null}
                      <option value="operator">Operator</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleInvite()}
                      disabled={saving || inviteEmail.trim().length === 0}
                      className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving ? "Sending..." : "Send invite"}
                    </button>
                  </div>
                ) : (
                  <p className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-4 text-sm text-slate-600 dark:text-slate-300">
                    Operators can review pending invitations here, but only
                    managers can send them.
                  </p>
                )}

                <div className="mt-6 space-y-3">
                  {detail.invitations.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-4 text-sm text-slate-500 dark:text-slate-400">
                      No pending invitations.
                    </div>
                  ) : (
                    detail.invitations.map((invite) => (
                      <div
                        key={invite.id}
                        className="flex flex-col gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
                      >
                        <div>
                          <p className="font-semibold text-slate-950 dark:text-white">
                            {invite.email}
                          </p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                            {formatRole(invite.role)} invited by{" "}
                            {invite.invitedBy.username}
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Expires {formatDate(invite.expiresAt)}
                          </p>
                        </div>

                        {detail.viewerRole !== "operator" ? (
                          <button
                            type="button"
                            onClick={() => void handleRevokeInvite(invite.id)}
                            disabled={saving}
                            className="inline-flex h-10 items-center justify-center rounded-2xl border border-slate-300 dark:border-slate-700 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-[1.8rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                    Members
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                    Team roster
                  </h2>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Shared posting access is still coming in a later phase. This
                  release focuses on membership and invites.
                </p>
              </div>

              <div className="mt-6 space-y-3">
                {detail.members.map((member) => {
                  const canPrimaryManagerEdit =
                    detail.viewerRole === "primary_manager" &&
                    member.role !== "primary_manager";
                  const canManagerRemove =
                    detail.viewerRole === "manager" &&
                    member.role === "operator";

                  return (
                    <div
                      key={member.membershipId}
                      className="grid gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-4 lg:grid-cols-[minmax(0,1.3fr)_0.7fr_0.8fr]"
                    >
                      <div>
                        <p className="font-semibold text-slate-950 dark:text-white">
                          {member.username}
                        </p>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                          {member.email}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Joined {formatDate(member.joinedAt)}
                        </p>
                      </div>

                      <div className="flex items-center">
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
                            className="h-11 w-full rounded-2xl border border-slate-300 dark:border-slate-700 px-4 text-slate-900 dark:text-white outline-none transition focus:border-slate-950 dark:focus:border-slate-400"
                          >
                            <option value="manager">Manager</option>
                            <option value="operator">Operator</option>
                          </select>
                        ) : (
                          <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                            {formatRole(member.role)}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-start lg:justify-end">
                        {canPrimaryManagerEdit || canManagerRemove ? (
                          <button
                            type="button"
                            onClick={() =>
                              void handleRemoveMember(member.membershipId)
                            }
                            disabled={saving}
                            className="inline-flex h-10 items-center justify-center rounded-2xl border border-rose-200 dark:border-rose-900/50 px-4 text-sm font-semibold text-rose-700 dark:text-rose-300 transition hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Remove
                          </button>
                        ) : (
                          <span className="text-sm text-slate-400 dark:text-slate-500">
                            No actions
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-[1.8rem] border border-slate-200 dark:border-slate-800 bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-6 py-6 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                Current limit
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
                Posting and payout ownership still follow the original owner
                account
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 dark:text-slate-600">
                Organizations are live now so teams can be invited and managed
                cleanly. Shared posting operations will move into this workspace
                in a follow-up phase.
              </p>
              <div className="mt-4">
                <Link
                  href="/dashboard"
                  className="inline-flex h-11 items-center justify-center rounded-2xl bg-white dark:bg-slate-900 px-5 text-sm font-semibold text-slate-950 dark:text-white transition hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Open owner dashboard
                </Link>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
