"use client";

import type {
  CreateOrganizationInviteInput,
  OrganizationRole,
} from "@/lib/organizations/api";
import {
  dangerButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/organizations/shared/styles";
import {
  InviteStatusBadge,
  RoleBadge,
} from "@/components/organizations/shared/badges";
import { formatDate } from "@/components/organizations/shared/format";
import {
  Avatar,
  SectionCard,
  SurfaceNote,
} from "@/components/organizations/shared/primitives";
import { useOrganizationWorkspace } from "@/components/organizations/workspace/workspace-provider";

export function TeamPanel() {
  const {
    detail,
    inviteCount,
    memberCount,
    inviteEmail,
    inviteRole,
    saving,
    canInvite,
    setInviteEmail,
    setInviteRole,
    handleInvite,
    handleRevokeInvite,
    handleUpdateMemberRole,
    handleRemoveMember,
  } = useOrganizationWorkspace();

  if (!detail) {
    return null;
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
      <SectionCard
        eyebrow="Invitations"
        title="Invite teammates"
        description={
          canInvite
            ? "Send an email invite and choose the role they will join with."
            : "Operators can review pending invitations here, but only managers can send them."
        }
        action={
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {inviteCount} pending
          </span>
        }
      >
        {canInvite ? (
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
    </div>
  );
}
