"use client";

import Link from "next/link";
import type { PostingStatus } from "@/lib/postings/api";
import {
  primaryButtonClass,
  rowActionMutedClass,
  rowActionPrimaryClass,
} from "@/components/organizations/shared/styles";
import { PostingStatusBadge } from "@/components/organizations/shared/badges";
import { formatPostingVariant } from "@/components/organizations/shared/format";
import { SectionCard } from "@/components/organizations/shared/primitives";
import { useOrganizationWorkspace } from "@/components/organizations/workspace/workspace-provider";
import type { PostingLifecycleAction } from "@/components/organizations/workspace/workspace-provider";

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

export function PostingsPanel() {
  const {
    canManagePostings,
    postingsLoading,
    postingsError,
    postings,
    postingsTotal,
    saving,
    handlePostingLifecycle,
  } = useOrganizationWorkspace();

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
                          void handlePostingLifecycle(posting.id, lifecycle.id)
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
              href="/postings/manage"
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
