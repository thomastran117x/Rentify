"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Check, MessagesSquare, Send, WifiOff } from "lucide-react";
import { Pagination } from "@/components/common/pagination";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import type { Pagination as PaginationMeta } from "@/lib/api/types";
import { bookingMessagesApi } from "@/lib/booking-messages/api";
import { openBookingMessageSocket } from "@/lib/booking-messages/socket";
import type { BookingMessageSocketHandle } from "@/lib/booking-messages/socket";
import {
  BOOKING_MESSAGE_EDIT_WINDOW_MS,
  MAX_BOOKING_MESSAGE_LENGTH,
  type BookingMessageAuthorSide,
  type BookingMessageRecord,
  type BookingMessageStreamStatus,
} from "@/lib/booking-messages/types";
import { formatDateTime } from "@/lib/rentings/format";

/** Fallback refresh cadence used once the live stream gives up. */
const FALLBACK_POLL_INTERVAL_MS = 15_000;
/** How close to the bottom still counts as "following" the conversation. */
const SCROLL_STICK_THRESHOLD_PX = 80;
/** How often the edit window is reevaluated while a control is on screen. */
const EDIT_WINDOW_TICK_MS = 15_000;
const PAGE_SIZE = 20;

interface PanelBanner {
  tone: "error" | "success";
  text: string;
}

interface BookingMessagesPanelProps {
  bookingRequestId: string;
  /**
   * Used only to decide which messages this user may edit or delete. Alignment
   * deliberately uses `viewerSide` instead: a colleague manager's message is on
   * your side of the thread but is not yours to change.
   */
  currentUserId: string;
}

/**
 * Keeps the page count honest after a live insert. Without this, the 41st
 * message in a 20-per-page thread still reports two pages, so page 2 repeats an
 * item shifted off page 1 and the oldest message becomes unreachable.
 */
function addToPagination(
  pagination: PaginationMeta,
  added: number,
): PaginationMeta {
  if (added <= 0) {
    return pagination;
  }

  const total = pagination.total + added;
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));

  return {
    ...pagination,
    total,
    totalPages,
    hasNextPage: pagination.page < totalPages,
    hasPreviousPage: pagination.page > 1,
  };
}

function bannerClasses(tone: PanelBanner["tone"]): string {
  return tone === "error"
    ? "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
    : "rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";
}

export function MessageBubble({
  message,
  mine,
  showReceipt = false,
  canModify = false,
  onEdit,
  onDelete,
  pending = false,
}: {
  message: BookingMessageRecord;
  mine: boolean;
  /**
   * Only the newest message you sent carries the receipt. Repeating it on every
   * bubble is noise: once a later message is read, every earlier one was too.
   */
  showReceipt?: boolean;
  /** Whether this viewer may still edit or delete this message. */
  canModify?: boolean;
  onEdit?: (message: BookingMessageRecord) => void;
  onDelete?: (message: BookingMessageRecord) => void;
  pending?: boolean;
}) {
  const deleted = Boolean(message.deletedAt);
  const readAt =
    showReceipt && message.readAt && !deleted ? message.readAt : null;

  return (
    <li
      className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
      data-testid="booking-message"
      data-mine={mine ? "true" : "false"}
    >
      <span className="mb-1 px-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        {message.authorUsername}
      </span>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
          deleted
            ? "border border-dashed border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
            : mine
              ? "bg-violet-600 text-white"
              : "border border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
        }`}
      >
        {deleted ? (
          <p className="italic">Message deleted</p>
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        )}
        <p
          className={`mt-2 flex flex-wrap items-center justify-end gap-1 text-[11px] ${
            deleted
              ? "text-slate-400 dark:text-slate-500"
              : mine
                ? "text-violet-100"
                : "text-slate-400 dark:text-slate-500"
          }`}
        >
          <span>{formatDateTime(message.createdAt) ?? ""}</span>
          {message.editedAt && !deleted ? <span>· edited</span> : null}
          {readAt ? (
            <span
              className="inline-flex items-center gap-0.5"
              title={`Read ${formatDateTime(readAt) ?? ""}`}
            >
              <Check aria-hidden="true" className="h-3 w-3" />
              Read {formatDateTime(readAt)}
            </span>
          ) : null}
        </p>
      </div>
      {canModify && !deleted ? (
        <div className="mt-1 flex gap-2 px-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => onEdit?.(message)}
            className="text-[11px] font-medium text-slate-500 underline-offset-2 transition hover:text-violet-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onDelete?.(message)}
            className="text-[11px] font-medium text-slate-500 underline-offset-2 transition hover:text-rose-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400"
          >
            Delete
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function MessageComposer({
  onSend,
  disabled,
  onTyping,
}: {
  onSend: (body: string) => Promise<boolean>;
  disabled: boolean;
  onTyping?: () => void;
}) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const tooLong = value.length > MAX_BOOKING_MESSAGE_LENGTH;
  const canSubmit = trimmed.length > 0 && !tooLong && !disabled;

  return (
    <form
      className="mt-4"
      onSubmit={async (event) => {
        event.preventDefault();

        if (!canSubmit) {
          return;
        }

        if (await onSend(trimmed)) {
          setValue("");
        }
      }}
    >
      <label className="sr-only" htmlFor="booking-message-body">
        Message
      </label>
      <textarea
        id="booking-message-body"
        name="body"
        rows={3}
        value={value}
        disabled={disabled}
        placeholder="Write a message about this booking..."
        onChange={(event) => {
          setValue(event.target.value);

          if (event.target.value.trim()) {
            onTyping?.();
          }
        }}
        className="w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span
          className={`text-xs ${
            tooLong
              ? "text-rose-600 dark:text-rose-400"
              : "text-slate-400 dark:text-slate-500"
          }`}
        >
          {value.length} / {MAX_BOOKING_MESSAGE_LENGTH}
        </span>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send aria-hidden="true" className="h-4 w-4" />
          {disabled ? "Sending..." : "Send"}
        </button>
      </div>
    </form>
  );
}

export function BookingMessagesPanel({
  bookingRequestId,
  currentUserId,
}: BookingMessagesPanelProps) {
  const [messages, setMessages] = useState<BookingMessageRecord[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  // Comes from the API rather than the session: only the server knows the
  // viewer's membership in this booking's organization. Defaults to false so
  // no composer is offered before the first load resolves.
  const [canWrite, setCanWrite] = useState(false);
  // Also from the API: alignment follows the viewer's *side*, so a second
  // organization manager sees a colleague's message as outgoing.
  const [viewerSide, setViewerSide] = useState<BookingMessageAuthorSide | null>(
    null,
  );
  const [counterpartName, setCounterpartName] = useState("");
  const [typingUsername, setTypingUsername] = useState<string | null>(null);
  const [counterpartOnline, setCounterpartOnline] = useState(false);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  // Re-rendered on a tick so the edit window can close on an idle thread. A
  // plain Date.now() check is never reevaluated without a render, leaving the
  // controls visible long after the server started rejecting them.
  const [now, setNow] = useState(() => Date.now());
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<PanelBanner | null>(null);
  const [liveStatus, setLiveStatus] =
    useState<BookingMessageStreamStatus>("connecting");
  const [, startTransition] = useTransition();

  const pageRef = useRef(page);
  pageRef.current = page;

  // Messages delivered by the stream while a history request is in flight. The
  // response would otherwise replace the whole array with a snapshot taken
  // before the insert, dropping the message until the next reconnect.
  const inFlightArrivalsRef = useRef<BookingMessageRecord[]>([]);
  // Edits and deletes delivered while a history request was in flight. The
  // response is a pre-change snapshot, so corrected text would revert and a
  // deleted message would reappear without this overlay.
  const inFlightUpdatesRef = useRef<Map<string, BookingMessageRecord>>(
    new Map(),
  );
  const loadTokenRef = useRef(0);
  // Mirrors the rendered message ids. Deduping here rather than inside a
  // setState updater keeps the decision synchronous: React may defer an
  // updater, so a flag set inside one cannot be read straight afterwards.
  const messageIdsRef = useRef<Set<string>>(new Set());

  // The stream effect reads these through refs so it depends only on the
  // booking id. Depending on the callbacks directly tore the connection down
  // and reopened it the moment the first list response changed `canWrite` and
  // `viewerSide`, opening two connections per mount and burning the per-user
  // stream rate limit after a handful of navigations.
  const viewerSideRef = useRef<BookingMessageAuthorSide | null>(null);
  viewerSideRef.current = viewerSide;
  const socketRef = useRef<BookingMessageSocketHandle | null>(null);
  const typingTimerRef = useRef<number | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Only follow the newest message when the reader is already at the bottom;
  // yanking someone away from older messages they are reading is worse than
  // letting a new one arrive off-screen.
  const stickToBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;

    if (!element) {
      return;
    }

    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= SCROLL_STICK_THRESHOLD_PX;
  }, []);

  const insertMessage = useCallback((record: BookingMessageRecord) => {
    // The same message arrives twice across a reconnect re-sync, and again as
    // the echo of a local send.
    if (messageIdsRef.current.has(record.id)) {
      return;
    }

    // Recorded before the early return: the POST response and the stream event
    // deliver the same record, and an unrecorded id would count it twice.
    messageIdsRef.current.add(record.id);

    // Newest-first paging puts every new message on page 1. Prepending it to an
    // older page would show a page-1 row there and push a row that does belong
    // off the end, so older pages only move their counters.
    if (pageRef.current !== 1) {
      setPagination((previous) =>
        previous ? addToPagination(previous, 1) : previous,
      );
      return;
    }

    // Trimmed back to a page: a 21-item page 1 leaves the server returning its
    // twentieth row again at the top of page 2, so the message shows twice.
    // The id set deliberately keeps trimmed ids — it only answers "already
    // inserted?", and it is rebuilt from scratch on every load.
    setMessages((previous) => [record, ...previous].slice(0, PAGE_SIZE));
    setPagination((previous) =>
      previous ? addToPagination(previous, 1) : previous,
    );
  }, []);

  const loadMessages = useCallback(
    async (targetPage: number, silent = false) => {
      if (!silent) {
        setLoading(true);
      }

      const token = loadTokenRef.current + 1;
      loadTokenRef.current = token;
      inFlightArrivalsRef.current = [];
      inFlightUpdatesRef.current = new Map();

      try {
        const result = await bookingMessagesApi.list(bookingRequestId, {
          page: targetPage,
          pageSize: PAGE_SIZE,
        });

        // A newer request superseded this one; its own merge is authoritative.
        if (loadTokenRef.current !== token) {
          return;
        }

        const arrivals = inFlightArrivalsRef.current;
        const updates = inFlightUpdatesRef.current;
        inFlightArrivalsRef.current = [];
        inFlightUpdatesRef.current = new Map();

        // Only the newest page can host live arrivals; on an older page they
        // are already accounted for by the server's ordering.
        const missed =
          targetPage === 1
            ? arrivals.filter(
                (arrival) =>
                  !result.messages.some((message) => message.id === arrival.id),
              )
            : [];

        // Capped like a live insert: a full page snapshotted before an
        // arrival would otherwise merge to 21 rows, and the server would hand
        // back the displaced row again at the top of the next page.
        const merged = [...missed, ...result.messages]
          .slice(0, PAGE_SIZE)
          .map((message) => updates.get(message.id) ?? message);
        messageIdsRef.current = new Set(merged.map((message) => message.id));

        startTransition(() => {
          setMessages(merged);
          setPagination(addToPagination(result.pagination, missed.length));
          // Skipped on a silent re-sync: that snapshot can predate a concurrent
          // markRead and would bring a cleared badge back.
          if (!silent) {
            setUnreadCount(result.unreadCount);
          }
          setCanWrite(result.canWrite);
          setViewerSide(result.viewerSide);
          setCounterpartName(result.counterpartName);
        });
      } catch (error) {
        setBanner({
          tone: "error",
          text: getApiErrorMessage(error, {
            action: "load messages",
            fallback: "We could not load this conversation.",
          }),
        });
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [bookingRequestId],
  );

  useEffect(() => {
    void loadMessages(page);
  }, [loadMessages, page]);

  const markRead = useCallback(async () => {
    // Mark-read requires the same permission as sending, so a read-only viewer
    // must not fire it at all.
    if (!canWrite) {
      return;
    }

    try {
      const result = await bookingMessagesApi.markRead(bookingRequestId);

      if (result.markedCount > 0) {
        setUnreadCount(0);
      }
    } catch {
      // Read receipts are advisory; a failure must not disrupt the thread.
    }
  }, [bookingRequestId, canWrite]);

  useEffect(() => {
    void markRead();

    function handleFocus() {
      void markRead();
    }

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [markRead]);

  useEffect(() => {
    let handle: BookingMessageSocketHandle | null = null;

    handle = openBookingMessageSocket({
      bookingRequestId,
      onStatus: (status) => {
        setLiveStatus(status);

        // The stream is not a durable log: re-sync on every successful
        // (re)connect so anything published while disconnected appears.
        if (status === "open") {
          void loadMessagesRef.current(pageRef.current, true);
        }
      },
      onEvent: (event) => {
        if (event.type === "message.created") {
          // Buffered so an in-flight history request can merge it back in
          // rather than replacing it with a pre-insert snapshot.
          inFlightArrivalsRef.current = [
            ...inFlightArrivalsRef.current,
            event.message,
          ];

          insertMessageRef.current(event.message);

          // Only messages from the other side are addressed to this viewer; a
          // colleague on the same side has not written to us.
          if (event.message.authorSide !== viewerSideRef.current) {
            void markReadRef.current();
          }

          return;
        }

        if (event.type === "typing") {
          // Ignore our own side's echo, and let the indicator expire on its own
          // rather than waiting for a "stopped typing" frame that may never
          // arrive if the sender drops.
          if (event.side === viewerSideRef.current) {
            return;
          }

          setTypingUsername(event.username);

          // A single timer, replaced on every frame. Scheduling one per frame
          // would let an earlier expiry hide an indicator a later frame had
          // already extended.
          if (typingTimerRef.current !== null) {
            window.clearTimeout(typingTimerRef.current);
          }

          const remaining = new Date(event.expiresAt).getTime() - Date.now();
          typingTimerRef.current = window.setTimeout(
            () => {
              typingTimerRef.current = null;
              setTypingUsername(null);
            },
            Math.max(0, remaining),
          );
          return;
        }

        if (event.type === "presence") {
          if (event.side === viewerSideRef.current) {
            return;
          }

          setCounterpartOnline(event.state === "online");
          return;
        }

        if (event.type === "messages.delivered") {
          setMessages((previous) =>
            previous.map((message) =>
              event.messageIds.includes(message.id) && !message.deliveredAt
                ? { ...message, deliveredAt: event.deliveredAt }
                : message,
            ),
          );
          return;
        }

        if (event.type === "message.updated") {
          inFlightUpdatesRef.current.set(event.message.id, event.message);

          // Edits and deletes replace in place; they never change ordering.
          setMessages((previous) =>
            previous.map((message) =>
              message.id === event.message.id ? event.message : message,
            ),
          );
          return;
        }

        // A read event marks the messages the *other* side authored. Keying
        // off the current user instead would flag your own messages as seen
        // when you, or anyone else on your side, opened the thread.
        //
        // The cutoff matters because a send racing a mark-read can have its
        // `message.created` frame overtake the `messages.read` frame: that row
        // was not covered by the update, so it must not display as seen.
        setMessages((previous) =>
          previous.map((message) =>
            message.authorSide !== event.readerSide &&
            !message.readAt &&
            message.createdAt <= event.readAt
              ? { ...message, readAt: event.readAt }
              : message,
          ),
        );
      },
    });

    socketRef.current = handle;

    return () => {
      socketRef.current = null;
      handle?.close();

      if (typingTimerRef.current !== null) {
        window.clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, [bookingRequestId]);

  useEffect(() => {
    if (!viewerSide) {
      return;
    }

    // Delivery is weaker than read: it says the bytes arrived, which is true
    // as soon as they are rendered here even if the tab is not focused.
    const unacknowledged = messages
      .filter(
        (message) => message.authorSide !== viewerSide && !message.deliveredAt,
      )
      .map((message) => message.id);

    if (unacknowledged.length > 0) {
      socketRef.current?.sendDelivered(unacknowledged);
    }
  }, [messages, viewerSide]);

  useEffect(() => {
    const element = scrollRef.current;

    if (!element || !stickToBottomRef.current) {
      return;
    }

    // The newest message sits at the bottom now, so that is where a reader
    // following the conversation expects to be.
    element.scrollTop = element.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    const hasEditable = messages.some(
      (message) =>
        message.authorId === currentUserId &&
        !message.deletedAt &&
        now - new Date(message.createdAt).getTime() <
          BOOKING_MESSAGE_EDIT_WINDOW_MS,
    );

    if (!hasEditable) {
      return;
    }

    // Only runs while a control is still on screen, so an idle thread with
    // nothing editable schedules nothing.
    const intervalId = window.setInterval(
      () => setNow(Date.now()),
      EDIT_WINDOW_TICK_MS,
    );

    return () => window.clearInterval(intervalId);
  }, [messages, currentUserId, now]);

  useEffect(() => {
    if (liveStatus !== "failed") {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadMessages(pageRef.current, true);
      }
    }, FALLBACK_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [liveStatus, loadMessages]);

  const handleSend = useCallback(
    async (body: string): Promise<boolean> => {
      setSending(true);
      setBanner(null);

      try {
        const created = await bookingMessagesApi.send(bookingRequestId, {
          body,
        });

        insertMessage(created);

        // Newest-first paging puts the sent message on page 1, so a sender
        // viewing older history would otherwise get no feedback at all.
        if (pageRef.current !== 1) {
          setPage(1);
        }

        return true;
      } catch (error) {
        setBanner({
          tone: "error",
          text: getApiErrorMessage(error, {
            action: "send message",
            fallback: "We could not send that message.",
          }),
        });

        return false;
      } finally {
        setSending(false);
      }
    },
    [bookingRequestId, insertMessage],
  );

  const applyUpdated = useCallback((record: BookingMessageRecord) => {
    setMessages((previous) =>
      previous.map((message) => (message.id === record.id ? record : message)),
    );
  }, []);

  const handleEdit = useCallback(
    async (message: BookingMessageRecord) => {
      const next = window.prompt("Edit your message", message.body);

      // An empty body fails the same validation the composer already guards
      // against, so treat clearing the prompt as a cancel rather than a 400.
      if (next === null || next.trim() === "" || next.trim() === message.body) {
        return;
      }

      setPendingMessageId(message.id);
      setBanner(null);

      try {
        applyUpdated(
          await bookingMessagesApi.edit(bookingRequestId, message.id, {
            body: next.trim(),
          }),
        );
      } catch (error) {
        setBanner({
          tone: "error",
          text: getApiErrorMessage(error, {
            action: "edit message",
            fallback: "We could not edit that message.",
          }),
        });
      } finally {
        setPendingMessageId(null);
      }
    },
    [applyUpdated, bookingRequestId],
  );

  const handleDelete = useCallback(
    async (message: BookingMessageRecord) => {
      if (!window.confirm("Delete this message? This cannot be undone.")) {
        return;
      }

      setPendingMessageId(message.id);
      setBanner(null);

      try {
        applyUpdated(
          await bookingMessagesApi.remove(bookingRequestId, message.id),
        );
      } catch (error) {
        setBanner({
          tone: "error",
          text: getApiErrorMessage(error, {
            action: "delete message",
            fallback: "We could not delete that message.",
          }),
        });
      } finally {
        setPendingMessageId(null);
      }
    },
    [applyUpdated, bookingRequestId],
  );

  // Mirrors the server rule so the controls disappear when the API would start
  // rejecting them, rather than offering an action that can only fail.
  const canModifyMessage = useCallback(
    (message: BookingMessageRecord): boolean =>
      canWrite &&
      !message.deletedAt &&
      message.authorId === currentUserId &&
      now - new Date(message.createdAt).getTime() <
        BOOKING_MESSAGE_EDIT_WINDOW_MS,
    [canWrite, currentUserId, now],
  );

  const loadMessagesRef = useRef(loadMessages);
  loadMessagesRef.current = loadMessages;
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;
  const insertMessageRef = useRef(insertMessage);
  insertMessageRef.current = insertMessage;

  // State stays newest-first because that is the order the API pages in, and
  // the trim, receipt, and merge logic all depend on it. Only the render is
  // reversed, so the thread reads top-to-bottom like any other chat.
  const orderedMessages = [...messages].reverse();

  // Messages are newest-first, so the first one from this side is the newest
  // this viewer sent. Page 2 and beyond never hold it, so the receipt would be
  // attached to a stale message there.
  const receiptMessageId =
    page === 1
      ? (messages.find(
          (message) => message.authorSide === viewerSide && !message.deletedAt,
        )?.id ?? null)
      : null;

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 text-slate-950 dark:text-white">
        <div className="flex items-center gap-2">
          <MessagesSquare aria-hidden="true" className="h-5 w-5" />
          <div>
            <h2 className="text-base font-semibold tracking-[-0.02em]">
              Messages
            </h2>
            {counterpartName ? (
              <p className="flex items-center gap-1.5 text-xs font-normal text-slate-500 dark:text-slate-400">
                <span
                  aria-hidden="true"
                  data-testid="counterpart-presence"
                  data-online={counterpartOnline ? "true" : "false"}
                  className={`inline-block h-2 w-2 rounded-full ${
                    counterpartOnline
                      ? "bg-emerald-500"
                      : "bg-slate-300 dark:bg-slate-600"
                  }`}
                />
                with {counterpartName}
                <span className="sr-only">
                  {counterpartOnline ? "online" : "offline"}
                </span>
              </p>
            ) : null}
          </div>
          {unreadCount > 0 ? (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
              {unreadCount} unread
            </span>
          ) : null}
        </div>
        {liveStatus === "failed" ? (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <WifiOff aria-hidden="true" className="h-3.5 w-3.5" />
            Live updates unavailable
          </span>
        ) : null}
      </div>

      {banner ? (
        <div className={`mt-4 ${bannerClasses(banner.tone)}`} role="alert">
          {banner.text}
        </div>
      ) : null}

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Loading conversation...
          </p>
        ) : messages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No messages yet. Start the conversation below.
          </div>
        ) : (
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="max-h-[28rem] overflow-y-auto pr-1"
          >
            <ul className="flex flex-col gap-3">
              {orderedMessages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  mine={message.authorSide === viewerSide}
                  showReceipt={message.id === receiptMessageId}
                  canModify={canModifyMessage(message)}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  pending={pendingMessageId === message.id}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      {typingUsername ? (
        <p
          className="mt-2 text-xs italic text-slate-500 dark:text-slate-400"
          aria-live="polite"
        >
          {typingUsername} is typing...
        </p>
      ) : null}

      {pagination && pagination.totalPages > 1 ? (
        <div className="mt-4">
          <Pagination
            pagination={pagination}
            onPageChange={setPage}
            itemLabel={{ one: "message", other: "messages" }}
            bordered={false}
            disabled={loading}
          />
        </div>
      ) : null}

      {canWrite ? (
        <MessageComposer
          onSend={handleSend}
          disabled={sending}
          onTyping={() => socketRef.current?.sendTyping()}
        />
      ) : (
        <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          You have read-only access to this conversation. Ask an organization
          manager to reply.
        </p>
      )}
    </section>
  );
}
