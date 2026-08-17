"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { AuthorAvatar } from "@/components/organizations/blog-visuals";
import { formatOrganizationDate } from "@/components/organizations/organization-public-visuals";
import { ReportDialog } from "@/components/reports/report-dialog";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { blogCommentsApi } from "@/lib/blog-comments/api";
import { openBlogCommentSocket } from "@/lib/blog-comments/socket";
import type { BlogCommentSocketHandle } from "@/lib/blog-comments/socket";
import {
  BLOG_COMMENT_EDIT_WINDOW_MS,
  MAX_BLOG_COMMENT_LENGTH,
  type BlogCommentRecord,
  type BlogCommentStreamEvent,
  type BlogCommentStreamStatus,
} from "@/lib/blog-comments/types";

const PAGE_SIZE = 50;

/** How often to refetch once the socket has given up. */
const FALLBACK_POLL_INTERVAL_MS = 15_000;

/** Presence below this is not worth showing — it is just the reader. */
const PRESENCE_DISPLAY_THRESHOLD = 2;

interface BlogCommentsPanelProps {
  organizationId: string;
  slug: string;
  blogPostId: string;
  /** Server-rendered starting value, replaced by the first list response. */
  commentsEnabled: boolean;
}

function isWithinEditWindow(comment: BlogCommentRecord): boolean {
  return (
    Date.now() - new Date(comment.createdAt).getTime() <
    BLOG_COMMENT_EDIT_WINDOW_MS
  );
}

function tombstoneLabel(comment: BlogCommentRecord): string {
  return comment.deletedBy === "moderator"
    ? "Removed by the organization."
    : "This comment was deleted.";
}

/**
 * Folds records into an existing list by id and returns them in display order.
 *
 * Later entries win, so callers order their inputs oldest-information-first.
 * The sort mirrors the server's tiebreak: two comments can share a timestamp,
 * and without the id the two would swap places between renders. ISO-8601 UTC
 * strings compare lexicographically, so no date parsing is needed.
 *
 * Display is oldest-first even though the API pages newest-first, because a
 * comment section reads as a conversation from the top down.
 */
function mergeComments(
  existing: BlogCommentRecord[],
  incoming: Iterable<BlogCommentRecord>,
): BlogCommentRecord[] {
  const byId = new Map(existing.map((comment) => [comment.id, comment]));

  for (const comment of incoming) {
    byId.set(comment.id, comment);
  }

  return [...byId.values()].sort((left, right) => {
    const byCreatedAt = left.createdAt.localeCompare(right.createdAt);

    return byCreatedAt !== 0 ? byCreatedAt : left.id.localeCompare(right.id);
  });
}

export function BlogCommentsPanel({
  organizationId,
  slug,
  blogPostId,
  commentsEnabled: initialCommentsEnabled,
}: BlogCommentsPanelProps) {
  const { status } = useAuth();
  const pathname = usePathname();
  const isAuthenticated = status === "authenticated";

  const [comments, setComments] = useState<BlogCommentRecord[]>([]);
  const [commentsEnabled, setCommentsEnabled] = useState(
    initialCommentsEnabled,
  );
  const [viewerCanComment, setViewerCanComment] = useState(false);
  const [viewerCanModerate, setViewerCanModerate] = useState(false);
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [liveStatus, setLiveStatus] =
    useState<BlogCommentStreamStatus>("connecting");
  const [readerCount, setReaderCount] = useState(0);
  const [typingUser, setTypingUser] = useState<string | null>(null);

  const socketRef = useRef<BlogCommentSocketHandle | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  /**
   * Events that landed while a history request was in flight, keyed by comment
   * so the newest one for a given comment wins. The response is a snapshot
   * taken before they happened, so replaying them over it is what stops a
   * freshly-posted comment vanishing on the next refetch.
   *
   * One map rather than separate arrival and update queues: a comment can be
   * created *and* then edited or deleted inside a single request window, and
   * keeping those apart made the stale creation win over the newer edit.
   */
  const pendingEventsRef = useRef(new Map<string, BlogCommentRecord>());
  const loadTokenRef = useRef(0);
  /** Comments already on screen, read during a load without becoming a dep. */
  const commentsRef = useRef<BlogCommentRecord[]>([]);
  /** How far back into history has been paged. Page 1 is the newest. */
  const deepestPageRef = useRef(1);
  /** Read during a load without making every request depend on auth state. */
  const isAuthenticatedRef = useRef(isAuthenticated);
  isAuthenticatedRef.current = isAuthenticated;

  const applyComment = useCallback((incoming: BlogCommentRecord) => {
    setComments((previous) => mergeComments(previous, [incoming]));
  }, []);

  /**
   * Reads a set of pages and folds them into the list as one operation.
   *
   * `extend` distinguishes the two callers. Paging backwards adds a page to
   * the window, so it keeps what is already on screen. A refresh re-reads
   * *every* page the reader has loaded and rebuilds the window from the
   * responses — anything less would leave an edit or a removal that happened
   * to an older comment while the socket was down permanently stale, because
   * the merge would keep preferring the copy already in state.
   */
  const loadComments = useCallback(
    async (options: {
      silent?: boolean;
      pages?: number[];
      extend?: boolean;
    }) => {
      const { silent = false, pages = [1], extend = false } = options;
      loadTokenRef.current += 1;
      const token = loadTokenRef.current;

      if (!silent) {
        setLoading(true);
      }

      pendingEventsRef.current.clear();

      try {
        const results = await Promise.all(
          pages.map((page) =>
            blogCommentsApi.list(organizationId, slug, {
              page,
              pageSize: PAGE_SIZE,
              // Signed-in readers take the refresh-capable path, so an expired
              // access token cannot silently downgrade them to the anonymous
              // envelope and hide their own composer.
              authenticated: isAuthenticatedRef.current,
            }),
          ),
        );

        // A newer load superseded this one while it was in flight.
        if (token !== loadTokenRef.current) {
          return;
        }

        // Responses first, then anything that landed while they were in
        // flight, so the freshest version of each comment wins regardless of
        // whether a snapshot contained it at all.
        setComments(
          mergeComments(extend ? commentsRef.current : [], [
            ...results.flatMap((result) => result.comments),
            ...pendingEventsRef.current.values(),
          ]),
        );

        // Every response carries the same viewer state; the newest page is as
        // good a source as any.
        const [newest] = results;
        setCommentsEnabled(newest.commentsEnabled);
        setViewerCanComment(newest.viewerCanComment);
        setViewerCanModerate(newest.viewerCanModerate);
        setViewerUserId(newest.viewerUserId);
        setError(null);

        // The boundary belongs to the deepest page read, not the newest one:
        // a refresh that re-reads pages 1-3 must not adopt page 1's "there is
        // more" and offer history the reader already has.
        const deepest = Math.max(...pages);
        const deepestResult = results[pages.indexOf(deepest)];
        deepestPageRef.current = Math.max(deepestPageRef.current, deepest);
        setHasEarlier(deepestResult.pagination.hasNextPage);
      } catch (cause) {
        if (token === loadTokenRef.current) {
          setError(
            getApiErrorMessage(cause, {
              action: "load comments",
              fallback:
                "We couldn't load comments right now. Please try again.",
            }),
          );
        }
      } finally {
        if (token === loadTokenRef.current) {
          setLoading(false);
        }
      }
    },
    [organizationId, slug],
  );

  /** Re-reads every page the reader has loaded. Usually just page 1. */
  const refreshLoadedPages = useCallback(
    (silent = true) =>
      loadComments({
        silent,
        pages: Array.from(
          { length: deepestPageRef.current },
          (_, index) => index + 1,
        ),
      }),
    [loadComments],
  );

  const loadEarlier = useCallback(async () => {
    setLoadingEarlier(true);

    try {
      await loadComments({
        silent: true,
        pages: [deepestPageRef.current + 1],
        extend: true,
      });
    } finally {
      setLoadingEarlier(false);
    }
  }, [loadComments]);

  // Refs so the socket effect below depends only on the post identity. Making
  // it depend on these callbacks tore the connection down and reopened it on
  // the first list response, which burned the ticket rate limit.
  const refreshRef = useRef(refreshLoadedPages);
  const applyCommentRef = useRef(applyComment);
  refreshRef.current = refreshLoadedPages;
  applyCommentRef.current = applyComment;
  commentsRef.current = comments;

  useEffect(() => {
    void loadComments({ pages: [1] });
    // `isAuthenticated` is a dependency because the session is restored
    // asynchronously: the first load can run before it resolves, and the
    // envelope it returns decides whether this reader is offered a composer.
  }, [loadComments, isAuthenticated]);

  useEffect(() => {
    const handle = openBlogCommentSocket({
      organizationId,
      slug,
      blogPostId,
      onStatus: (next) => {
        setLiveStatus(next);

        if (next === "open") {
          // The stream is not a durable log: anything published while this
          // client was away was never queued for it.
          void refreshRef.current();
        }
      },
      onEvent: (event: BlogCommentStreamEvent) => {
        switch (event.type) {
          case "comment.created":
          case "comment.updated":
          case "comment.deleted": {
            // Recorded unconditionally and keyed by id, so the last event for a
            // comment is the one replayed over an in-flight history response.
            pendingEventsRef.current.set(event.comment.id, event.comment);
            applyCommentRef.current(event.comment);
            break;
          }
          case "typing": {
            setTypingUser(event.username);

            if (typingTimerRef.current) {
              window.clearTimeout(typingTimerRef.current);
            }

            const remaining = Math.max(
              0,
              new Date(event.expiresAt).getTime() - Date.now(),
            );
            typingTimerRef.current = window.setTimeout(
              () => setTypingUser(null),
              remaining,
            );
            break;
          }
          case "presence": {
            setReaderCount(event.readerCount);
            break;
          }
          case "comments.closed": {
            setCommentsEnabled(event.commentsEnabled);
            // The list response is the authority on whether this viewer may
            // post, so re-read it rather than inferring.
            void refreshRef.current();
            break;
          }
          case "resync": {
            void refreshRef.current();
            break;
          }
        }
      },
    });

    socketRef.current = handle;

    return () => {
      handle.close();
      socketRef.current = null;

      if (typingTimerRef.current) {
        window.clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, [organizationId, slug, blogPostId]);

  // Fallback polling once the socket has given up, so a reader behind a proxy
  // that blocks WebSockets still sees new comments.
  useEffect(() => {
    if (liveStatus !== "failed") {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshRef.current();
      }
    }, FALLBACK_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [liveStatus]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      const body = draft.trim();

      if (!body) {
        setFormError("Write something before posting.");
        return;
      }

      setSubmitting(true);
      setFormError(null);

      try {
        const created = await blogCommentsApi.create(
          organizationId,
          slug,
          body,
        );
        // Inserted from the response rather than optimistically; the socket
        // echo is deduped by id.
        applyComment(created);
        setDraft("");
      } catch (cause) {
        setFormError(
          getApiErrorMessage(cause, {
            action: "post your comment",
            fallback: "We couldn't post your comment right now.",
            // Surfaces the server's own wording for a closed thread or a
            // per-account cooldown, both of which are actionable.
            preserveClientMessage: true,
          }),
        );
      } finally {
        setSubmitting(false);
      }
    },
    [applyComment, draft, organizationId, slug],
  );

  const handleSaveEdit = useCallback(
    async (commentId: string) => {
      const body = editDraft.trim();

      if (!body) {
        return;
      }

      setSavingEdit(true);
      setFormError(null);

      try {
        const updated = await blogCommentsApi.update(
          organizationId,
          slug,
          commentId,
          body,
        );
        applyComment(updated);
        setEditingId(null);
        setEditDraft("");
      } catch (cause) {
        setFormError(
          getApiErrorMessage(cause, {
            action: "save your edit",
            fallback: "We couldn't save that edit right now.",
            preserveClientMessage: true,
          }),
        );
      } finally {
        setSavingEdit(false);
      }
    },
    [applyComment, editDraft, organizationId, slug],
  );

  const handleRemove = useCallback(
    async (commentId: string) => {
      setRemovingId(commentId);
      setFormError(null);

      try {
        const removed = await blogCommentsApi.remove(
          organizationId,
          slug,
          commentId,
        );
        applyComment(removed);
      } catch (cause) {
        setFormError(
          getApiErrorMessage(cause, {
            action: "remove that comment",
            fallback: "We couldn't remove that comment right now.",
            preserveClientMessage: true,
          }),
        );
      } finally {
        setRemovingId(null);
      }
    },
    [applyComment, organizationId, slug],
  );

  /**
   * The list response is authoritative once it lands. Before then — and if it
   * failed — fall back to the same rule the server applies, so a signed-in
   * reader is not shown a sign-in prompt while the first request is in flight.
   */
  const canComment =
    loading || error ? isAuthenticated && commentsEnabled : viewerCanComment;
  const liveCount = comments.filter((comment) => !comment.deletedAt).length;

  return (
    <section
      aria-labelledby="comments-heading"
      className="mt-12 border-t border-slate-200 pt-8 dark:border-slate-800"
      data-testid="blog-comments"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
            <MessageSquare className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2
              id="comments-heading"
              className="text-lg font-semibold text-slate-950 dark:text-white"
            >
              Comments
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {liveCount === 0
                ? "No comments yet."
                : `${liveCount} ${liveCount === 1 ? "comment" : "comments"}`}
            </p>
          </div>
        </div>

        {readerCount >= PRESENCE_DISPLAY_THRESHOLD ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            data-testid="blog-comments-presence"
            data-reader-count={readerCount}
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            {readerCount > 99 ? "99+" : readerCount} people reading
          </span>
        ) : null}
      </div>

      {commentsEnabled ? (
        canComment ? (
          <form onSubmit={handleSubmit} className="mt-6">
            <label htmlFor="blog-comment-body" className="sr-only">
              Add a comment
            </label>
            <textarea
              id="blog-comment-body"
              data-testid="blog-comment-composer"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                socketRef.current?.sendTyping();
              }}
              maxLength={MAX_BLOG_COMMENT_LENGTH}
              rows={3}
              placeholder="Share your thoughts"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-800 dark:bg-slate-950/40 dark:text-white dark:focus:ring-violet-500/20"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {draft.length}/{MAX_BLOG_COMMENT_LENGTH}
              </span>
              <button
                type="submit"
                data-testid="blog-comment-submit"
                disabled={submitting || draft.trim().length === 0}
                className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Posting…" : "Post comment"}
              </button>
            </div>
          </form>
        ) : (
          <p
            className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300"
            data-testid="blog-comments-signin"
          >
            <Link
              href={`/login?next=${encodeURIComponent(pathname ?? "/")}`}
              className="font-semibold text-violet-700 hover:text-violet-800 dark:text-violet-300"
            >
              Sign in to comment
            </Link>{" "}
            and join the conversation.
          </p>
        )
      ) : (
        <p
          className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300"
          data-testid="blog-comments-closed"
        >
          Comments are closed on this post.
        </p>
      )}

      {formError ? (
        <p
          role="alert"
          className="mt-3 text-sm text-rose-600 dark:text-rose-400"
        >
          {formError}
        </p>
      ) : null}

      <p
        className="mt-3 h-5 text-xs text-slate-500 dark:text-slate-400"
        aria-live="polite"
        data-testid="blog-comments-typing"
      >
        {typingUser ? `${typingUser} is typing…` : ""}
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          Loading comments…
        </p>
      ) : error ? (
        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
          <p role="alert">{error}</p>
          <button
            type="button"
            onClick={() => void loadComments({ pages: [1] })}
            className="mt-2 text-sm font-semibold underline"
          >
            Try again
          </button>
        </div>
      ) : comments.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          Be the first to comment on this post.
        </p>
      ) : (
        <>
          {hasEarlier ? (
            <button
              type="button"
              onClick={() => void loadEarlier()}
              disabled={loadingEarlier}
              data-testid="blog-comments-load-earlier"
              className="mt-6 w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:text-slate-300 dark:hover:text-white"
            >
              {loadingEarlier ? "Loading…" : "Load earlier comments"}
            </button>
          ) : null}

          <ul className="mt-6 space-y-5">
            {comments.map((comment) => {
              const isOwn = comment.author.id === viewerUserId;
              const canEdit =
                isOwn &&
                !comment.deletedAt &&
                commentsEnabled &&
                isWithinEditWindow(comment);
              const canRemove =
                !comment.deletedAt && (isOwn || viewerCanModerate);

              return (
                <li
                  key={comment.id}
                  data-testid="blog-comment"
                  data-comment-id={comment.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60"
                >
                  <div className="flex items-start gap-3">
                    {/*
                    The avatar helper is typed against the blog post author,
                    which carries an email. A comment author deliberately does
                    not, so an empty string stands in for the initials
                    fallback — it never reaches the rendered output because a
                    username is always present.
                  */}
                    <AuthorAvatar
                      author={{ ...comment.author, email: "" }}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">
                          {comment.author.username}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {formatOrganizationDate(comment.createdAt)}
                        </span>
                        {comment.editedAt && !comment.deletedAt ? (
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            (edited)
                          </span>
                        ) : null}
                      </div>

                      {comment.deletedAt ? (
                        <p
                          className="mt-2 text-sm italic text-slate-500 dark:text-slate-400"
                          data-testid="blog-comment-tombstone"
                          data-deleted-by={comment.deletedBy ?? ""}
                        >
                          {tombstoneLabel(comment)}
                        </p>
                      ) : editingId === comment.id ? (
                        <div className="mt-2">
                          <textarea
                            value={editDraft}
                            onChange={(event) =>
                              setEditDraft(event.target.value)
                            }
                            maxLength={MAX_BLOG_COMMENT_LENGTH}
                            rows={3}
                            data-testid="blog-comment-edit-input"
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-violet-400 dark:border-slate-800 dark:bg-slate-950/40 dark:text-white"
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              disabled={savingEdit}
                              onClick={() => void handleSaveEdit(comment.id)}
                              data-testid="blog-comment-edit-save"
                              className="rounded-full bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
                            >
                              {savingEdit ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(null);
                                setEditDraft("");
                              }}
                              className="rounded-full border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        /*
                        Rendered as text, never as HTML — unlike the post body
                        above it, this is untrusted input from any signed-in
                        user.
                      */
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-200">
                          {comment.body}
                        </p>
                      )}

                      {!comment.deletedAt && editingId !== comment.id ? (
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                          {canEdit ? (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(comment.id);
                                setEditDraft(comment.body);
                              }}
                              data-testid="blog-comment-edit"
                              className="inline-flex items-center gap-1 font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                            >
                              <Pencil
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              Edit
                            </button>
                          ) : null}
                          {canRemove ? (
                            <button
                              type="button"
                              disabled={removingId === comment.id}
                              onClick={() => void handleRemove(comment.id)}
                              data-testid="blog-comment-remove"
                              className="inline-flex items-center gap-1 font-medium text-slate-500 transition hover:text-rose-600 disabled:opacity-60 dark:text-slate-400 dark:hover:text-rose-400"
                            >
                              <Trash2
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              {isOwn ? "Delete" : "Remove"}
                            </button>
                          ) : null}
                          {!isOwn ? (
                            <ReportDialog
                              subjectType="organization_blog_comment"
                              subjectId={comment.id}
                              subjectLabel="Comment"
                              triggerLabel="Report"
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
