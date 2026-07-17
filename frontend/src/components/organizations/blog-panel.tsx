"use client";

import { useState } from "react";
import Link from "next/link";
import { blobApi } from "@/lib/blob/api";
import type {
  OrganizationBlogPostRecord,
  OrganizationBlogStatus,
} from "@/lib/organizations/api";
import { RichTextEditor } from "@/components/organizations/rich-text-editor";

export interface BlogFormValue {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  tags: string[];
  coverImageUrl: string;
  coverImageBlobName: string;
  status: OrganizationBlogStatus;
}

export function emptyBlogForm(): BlogFormValue {
  return {
    title: "",
    slug: "",
    excerpt: "",
    body: "",
    tags: [],
    coverImageUrl: "",
    coverImageBlobName: "",
    status: "draft",
  };
}

const BLOG_STATUS_STYLES: Record<OrganizationBlogStatus, string> = {
  draft:
    "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  published:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
};

const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition duration-200 placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-400 dark:focus:ring-sky-500/20";
const labelClass =
  "mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200";
const primaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200";
const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition duration-200 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-900/60 dark:hover:bg-sky-950/30 dark:hover:text-sky-300";
const rowActionClass =
  "inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-900/60 dark:hover:bg-sky-950/30 dark:hover:text-sky-300";
const dangerButtonClass =
  "inline-flex h-10 items-center justify-center rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/40";
const cardClass =
  "rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/40";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function CoverImageUploader({
  coverImageUrl,
  onUploaded,
  onRemove,
  onError,
  disabled,
}: {
  coverImageUrl: string;
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
      onError("We couldn't upload that cover image. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-2">
      <span className={labelClass}>Cover image</span>
      <div className="flex items-center gap-4">
        {coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverImageUrl}
            alt="Blog cover"
            className="h-20 w-32 shrink-0 rounded-xl object-cover ring-1 ring-slate-200 dark:ring-slate-700"
          />
        ) : (
          <div className="flex h-20 w-32 shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-300 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
            No cover
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${secondaryButtonClass} cursor-pointer`}>
            {uploading
              ? "Uploading..."
              : coverImageUrl
                ? "Replace cover"
                : "Upload cover"}
            <input
              type="file"
              accept="image/*"
              aria-label="Upload blog cover image"
              className="sr-only"
              disabled={disabled || uploading}
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {coverImageUrl ? (
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

function TagsInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function addTag() {
    const value = draft.trim();
    if (!value) {
      return;
    }
    if (!tags.includes(value) && tags.length < 10) {
      onChange([...tags, value]);
    }
    setDraft("");
  }

  return (
    <div>
      <label htmlFor="blog-tags" className={labelClass}>
        Tags
      </label>
      {tags.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => onChange(tags.filter((entry) => entry !== tag))}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-100"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <input
        id="blog-tags"
        type="text"
        value={draft}
        maxLength={40}
        placeholder="Add a tag and press Enter"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            addTag();
          }
        }}
        onBlur={addTag}
        className={inputClass}
        disabled={tags.length >= 10}
      />
    </div>
  );
}

export function BlogPanel({
  organizationId,
  posts,
  loading,
  error,
  canManage,
  form,
  editingId,
  savingId,
  onFormChange,
  onSubmit,
  onCancelEdit,
  onEdit,
  onToggleStatus,
  onDelete,
  onError,
}: {
  organizationId: string;
  posts: OrganizationBlogPostRecord[];
  loading: boolean;
  error: string | null;
  canManage: boolean;
  form: BlogFormValue;
  editingId: string | null;
  savingId: string | null;
  onFormChange: (value: BlogFormValue) => void;
  onSubmit: () => void;
  onCancelEdit: () => void;
  onEdit: (post: OrganizationBlogPostRecord) => void;
  onToggleStatus: (post: OrganizationBlogPostRecord) => void;
  onDelete: (postId: string) => void;
  onError: (message: string) => void;
}) {
  const isSaving = savingId !== null;

  return (
    <div className="space-y-6">
      {canManage ? (
        <section className={cardClass}>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">
            Blog
          </p>
          <h3 className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">
            {editingId ? "Edit blog post" : "Write a blog post"}
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Public marketing posts. Published posts are visible to anyone;
            drafts stay private to your team.
          </p>

          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="blog-title" className={labelClass}>
                Title
              </label>
              <input
                id="blog-title"
                type="text"
                value={form.title}
                maxLength={200}
                onChange={(event) =>
                  onFormChange({ ...form, title: event.target.value })
                }
                placeholder="Introducing weekend stays"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="blog-excerpt" className={labelClass}>
                Excerpt <span className="text-slate-400">(optional)</span>
              </label>
              <textarea
                id="blog-excerpt"
                value={form.excerpt}
                maxLength={300}
                rows={2}
                onChange={(event) =>
                  onFormChange({ ...form, excerpt: event.target.value })
                }
                placeholder="A short summary shown on the blog list and link previews."
                className={`${inputClass} h-auto py-3`}
              />
            </div>

            <CoverImageUploader
              coverImageUrl={form.coverImageUrl}
              onUploaded={(blobUrl, blobName) =>
                onFormChange({
                  ...form,
                  coverImageUrl: blobUrl,
                  coverImageBlobName: blobName,
                })
              }
              onRemove={() =>
                onFormChange({
                  ...form,
                  coverImageUrl: "",
                  coverImageBlobName: "",
                })
              }
              onError={onError}
              disabled={isSaving}
            />

            <TagsInput
              tags={form.tags}
              onChange={(tags) => onFormChange({ ...form, tags })}
            />

            <div>
              <span className={labelClass}>Body</span>
              <RichTextEditor
                value={form.body}
                onChange={(html) => onFormChange({ ...form, body: html })}
              />
            </div>

            <div>
              <label htmlFor="blog-status" className={labelClass}>
                Visibility
              </label>
              <select
                id="blog-status"
                value={form.status}
                onChange={(event) =>
                  onFormChange({
                    ...form,
                    status: event.target.value as OrganizationBlogStatus,
                  })
                }
                className={inputClass}
              >
                <option value="draft">Draft (private to your team)</option>
                <option value="published">Published (public)</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onSubmit}
                disabled={isSaving}
                className={primaryButtonClass}
              >
                {isSaving
                  ? "Saving..."
                  : editingId
                    ? "Save changes"
                    : "Publish post"}
              </button>
              {editingId ? (
                <button
                  type="button"
                  onClick={onCancelEdit}
                  disabled={isSaving}
                  className={secondaryButtonClass}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className={cardClass}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">
              Blog posts
            </p>
            <h3 className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">
              Your posts
            </h3>
          </div>
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {posts.length} total
          </span>
        </div>

        <div className="mt-5">
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
          ) : posts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {canManage
                ? "No blog posts yet. Write your first post above."
                : "No blog posts yet."}
            </div>
          ) : (
            <div className="space-y-3">
              {posts.map((post) => (
                <div
                  key={post.id}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-4 lg:flex-row lg:items-start lg:justify-between dark:border-slate-800 dark:bg-slate-950/40"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950 dark:text-white">
                        {post.title}
                      </p>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${BLOG_STATUS_STYLES[post.status]}`}
                      >
                        {post.status}
                      </span>
                    </div>
                    {post.excerpt ? (
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {post.excerpt}
                      </p>
                    ) : null}
                    {post.tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {post.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      {post.author?.username ?? "System"} /{" "}
                      {formatDate(post.createdAt)}
                      {post.status === "published" ? (
                        <>
                          {" · "}
                          <Link
                            href={`/organizations/${organizationId}/blog/${post.slug}`}
                            className="text-sky-600 hover:underline dark:text-sky-400"
                            target="_blank"
                          >
                            View public post
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onToggleStatus(post)}
                        disabled={isSaving}
                        className={rowActionClass}
                      >
                        {post.status === "published" ? "Unpublish" : "Publish"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(post)}
                        disabled={isSaving}
                        className={rowActionClass}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(post.id)}
                        disabled={isSaving}
                        className={rowActionClass}
                      >
                        {savingId === post.id ? "Working..." : "Delete"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
