"use client";

import Link from "next/link";
import type { OrganizationAnnouncementStatus } from "@/lib/organizations/api";
import {
  inputClass,
  primaryButtonClass,
  rowActionMutedClass,
  secondaryButtonClass,
} from "@/components/organizations/shared/styles";
import { ANNOUNCEMENT_STATUS_STYLES } from "@/components/organizations/shared/badges";
import { formatDateTime } from "@/components/organizations/shared/format";
import { SectionCard } from "@/components/organizations/shared/primitives";
import { BlogPanel } from "@/components/organizations/blog-panel";
import { ReviewsPanel } from "@/components/organizations/reviews-panel";
import { useOrganizationWorkspace } from "@/components/organizations/workspace/workspace-provider";

type ContentTab = "announcements" | "blog" | "reviews";

function AnnouncementsSection() {
  const {
    announcements,
    announcementsLoading: loading,
    announcementsError: error,
    canManageAnnouncements: canManage,
    announcementForm: form,
    setAnnouncementForm: onFormChange,
    editingAnnouncementId: editingId,
    announcementSavingId: savingId,
    handleSubmitAnnouncement,
    handleCancelEditAnnouncement,
    handleEditAnnouncement,
    handleToggleAnnouncementStatus,
    handleDeleteAnnouncement,
  } = useOrganizationWorkspace();

  const isCreating = savingId === "new";

  return (
    <div className="space-y-6">
      {canManage ? (
        <SectionCard
          eyebrow="Announcements"
          title={editingId ? "Edit announcement" : "Post an announcement"}
          description="Share updates with everyone in this organization. Drafts stay hidden from operators until published."
        >
          <div className="space-y-4">
            <div>
              <label
                htmlFor="announcement-title"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Title
              </label>
              <input
                id="announcement-title"
                type="text"
                value={form.title}
                maxLength={200}
                onChange={(event) =>
                  onFormChange({ ...form, title: event.target.value })
                }
                placeholder="Weekend booking update"
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="announcement-body"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Message
              </label>
              <textarea
                id="announcement-body"
                value={form.body}
                maxLength={10000}
                rows={4}
                onChange={(event) =>
                  onFormChange({ ...form, body: event.target.value })
                }
                placeholder="Let your team know what's new."
                className={`${inputClass} h-auto py-3`}
              />
            </div>
            <div>
              <label
                htmlFor="announcement-status"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Visibility
              </label>
              <select
                id="announcement-status"
                value={form.status}
                onChange={(event) =>
                  onFormChange({
                    ...form,
                    status: event.target
                      .value as OrganizationAnnouncementStatus,
                  })
                }
                className={inputClass}
              >
                <option value="draft">Draft (only managers)</option>
                <option value="published">Published (everyone)</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSubmitAnnouncement()}
                disabled={savingId !== null}
                className={primaryButtonClass}
              >
                {isCreating || (editingId && savingId === editingId)
                  ? "Saving..."
                  : editingId
                    ? "Save changes"
                    : "Post announcement"}
              </button>
              {editingId ? (
                <button
                  type="button"
                  onClick={handleCancelEditAnnouncement}
                  disabled={savingId !== null}
                  className={secondaryButtonClass}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        eyebrow="Team updates"
        title="Announcements"
        description={
          canManage
            ? "Everything you've shared with this organization."
            : "Updates shared by your organization managers."
        }
        action={
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {announcements.length} posted
          </span>
        }
      >
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-24 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/70"
              />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {error}
          </div>
        ) : announcements.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {canManage
              ? "No announcements yet. Post the first update above."
              : "No announcements yet."}
          </div>
        ) : (
          <div className="space-y-3">
            {announcements.map((announcement) => (
              <div
                key={announcement.id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-4 lg:flex-row lg:items-start lg:justify-between dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-950 dark:text-white">
                      {announcement.title}
                    </p>
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${ANNOUNCEMENT_STATUS_STYLES[announcement.status]}`}
                    >
                      {announcement.status}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                    {announcement.body}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {announcement.author?.username ?? "System"} /{" "}
                    {formatDateTime(announcement.createdAt)}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void handleToggleAnnouncementStatus(announcement)
                      }
                      disabled={savingId !== null}
                      className={rowActionMutedClass}
                    >
                      {announcement.status === "published"
                        ? "Unpublish"
                        : "Publish"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEditAnnouncement(announcement)}
                      disabled={savingId !== null}
                      className={rowActionMutedClass}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void handleDeleteAnnouncement(announcement.id)
                      }
                      disabled={savingId !== null}
                      className={rowActionMutedClass}
                    >
                      {savingId === announcement.id ? "Working..." : "Delete"}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function BlogSection() {
  const {
    detail,
    blogPosts,
    blogLoading,
    blogError,
    canManageBlog,
    blogForm,
    editingBlogPostId,
    blogSavingId,
    setBlogForm,
    handleSubmitBlogPost,
    handleCancelEditBlogPost,
    handleEditBlogPost,
    handleToggleBlogStatus,
    handleDeleteBlogPost,
    showWorkspaceToast,
  } = useOrganizationWorkspace();

  return (
    <BlogPanel
      organizationId={detail?.organization.id ?? ""}
      posts={blogPosts}
      loading={blogLoading}
      error={blogError}
      canManage={canManageBlog}
      form={blogForm}
      editingId={editingBlogPostId}
      savingId={blogSavingId}
      onFormChange={setBlogForm}
      onSubmit={() => void handleSubmitBlogPost()}
      onCancelEdit={handleCancelEditBlogPost}
      onEdit={handleEditBlogPost}
      onToggleStatus={(post) => void handleToggleBlogStatus(post)}
      onDelete={(postId) => void handleDeleteBlogPost(postId)}
      onError={(msg) => showWorkspaceToast("Cover image", msg)}
    />
  );
}

function ReviewsSection() {
  const { detail, canManageBlog } = useOrganizationWorkspace();

  return (
    <ReviewsPanel
      organizationId={detail?.organization.id ?? ""}
      canManage={canManageBlog}
    />
  );
}

const CONTENT_TABS: Array<{ id: ContentTab; label: string }> = [
  { id: "announcements", label: "Announcements" },
  { id: "blog", label: "Blog" },
  { id: "reviews", label: "Reviews" },
];

// The active sub-tab is driven by the `?view=` search param (resolved to
// `initialTab` by the Content route) rather than local state, so refreshing,
// bookmarking, or navigating back to /content?view=blog reopens the Blog tab.
export function ContentPanel({
  initialTab = "announcements",
}: {
  initialTab?: ContentTab;
} = {}) {
  const activeTab = initialTab;

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Content type"
        className="inline-flex rounded-2xl border border-slate-200 bg-white/90 p-1 dark:border-slate-800 dark:bg-slate-900/90"
      >
        {CONTENT_TABS.map((entry) => {
          const selected = activeTab === entry.id;
          return (
            <Link
              key={entry.id}
              href={`/dashboard/organizations/content?view=${entry.id}`}
              scroll={false}
              role="tab"
              aria-selected={selected}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                selected
                  ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              }`}
            >
              {entry.label}
            </Link>
          );
        })}
      </div>

      {activeTab === "announcements" ? (
        <AnnouncementsSection />
      ) : activeTab === "blog" ? (
        <BlogSection />
      ) : (
        <ReviewsSection />
      )}
    </div>
  );
}
