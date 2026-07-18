"use client";

import {
  inputClass,
  secondaryButtonClass,
} from "@/components/organizations/shared/styles";
import { RoleBadge } from "@/components/organizations/shared/badges";
import {
  formatDate,
  formatRole,
} from "@/components/organizations/shared/format";
import {
  Eyebrow,
  StatTile,
} from "@/components/organizations/shared/primitives";
import { OrganizationCreateForm } from "@/components/organizations/workspace/create-form";
import { useOrganizationWorkspace } from "@/components/organizations/workspace/workspace-provider";

export function OrganizationWorkspaceHeader() {
  const {
    detail,
    workspace,
    selectedOrganizationId,
    saving,
    showCreatePanel,
    toggleCreatePanel,
    handleSelectOrganization,
    memberCount,
    inviteCount,
    postingsTotal,
    postingsLoading,
    newOrganizationName,
    setNewOrganizationName,
    handleCreate,
    createProfile,
    handleCreateProfileChange,
    showWorkspaceToast,
  } = useOrganizationWorkspace();

  if (!workspace) {
    return null;
  }

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
                onChange={(event) =>
                  void handleSelectOrganization(event.target.value)
                }
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
              onClick={toggleCreatePanel}
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
            <div className="mt-3">
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
            </div>
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
