"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { FormErrorMessage } from "@/components/errors";
import { Eyebrow } from "@/components/organizations/shared/primitives";
import { OrganizationCreateForm } from "@/components/organizations/workspace/create-form";
import { OrganizationWorkspaceHeader } from "@/components/organizations/workspace/workspace-header";
import { findSectionBySegment } from "@/components/organizations/workspace/section-registry";
import { useOrganizationWorkspace } from "@/components/organizations/workspace/workspace-provider";
import { usePublishActiveOrganizationRole } from "@/components/navigation/app-shell/active-organization-role";

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

function WorkspaceLoadingSkeleton() {
  return (
    <OrganizationPageShell>
      <div className="space-y-6">
        <div className="h-48 animate-pulse rounded-[1.8rem] bg-slate-200/70 dark:bg-slate-800/70" />
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

function OrganizationEmptyState() {
  const {
    newOrganizationName,
    setNewOrganizationName,
    handleCreate,
    saving,
    errorTitle,
    error,
    createProfile,
    handleCreateProfileChange,
    showWorkspaceToast,
  } = useOrganizationWorkspace();

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
    </OrganizationPageShell>
  );
}

export function WorkspaceChrome({ children }: { children: ReactNode }) {
  const router = useRouter();
  const activeSegment = useSelectedLayoutSegment();
  const {
    status,
    session,
    loading,
    workspace,
    detail,
    error,
    errorTitle,
    message,
  } = useOrganizationWorkspace();

  // Central access control: the sidebar hides sections a role can't open, and
  // this guard catches direct URL entry for every gated section from the
  // registry — so a new gated route is protected without per-page wrappers.
  const activeSection = findSectionBySegment(activeSegment);
  const sectionAllowed = activeSection
    ? activeSection.canAccess(detail?.viewerRole)
    : true;

  useEffect(() => {
    if (detail && activeSection && !sectionAllowed) {
      router.replace("/dashboard/organizations/overview");
    }
  }, [detail, activeSection, sectionAllowed, router]);

  // The app-shell sidebar renders these sections but sits above this provider,
  // so hand it the role we actually resolved. Must run before the early returns.
  usePublishActiveOrganizationRole(detail?.viewerRole);

  if (status === "loading" || loading) {
    return <WorkspaceLoadingSkeleton />;
  }

  if (status !== "authenticated" || !session) {
    return null;
  }

  if (!workspace || workspace.memberships.length === 0) {
    return <OrganizationEmptyState />;
  }

  return (
    <OrganizationPageShell>
      <OrganizationWorkspaceHeader />

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

      <div className="min-w-0 space-y-6">{sectionAllowed ? children : null}</div>
    </OrganizationPageShell>
  );
}
