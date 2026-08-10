"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Check, MessagesSquare, Send, WifiOff } from "lucide-react";
import { Pagination } from "@/components/common/pagination";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import type { Pagination as PaginationMeta } from "@/lib/api/types";
import { bookingMessagesApi } from "@/lib/booking-messages/api";
import { openBookingMessageStream } from "@/lib/booking-messages/stream";
import type { BookingMessageStreamHandle } from "@/lib/booking-messages/stream";
import {
  MAX_BOOKING_MESSAGE_LENGTH,
  type BookingMessageRecord,
  type BookingMessageStreamStatus,
} from "@/lib/booking-messages/types";
import { formatDateTime } from "@/lib/rentings/format";

/** Fallback refresh cadence used once the live stream gives up. */
const FALLBACK_POLL_INTERVAL_MS = 15_000;
const PAGE_SIZE = 20;

interface PanelBanner {
  tone: "error" | "success";
  text: string;
}

interface BookingMessagesPanelProps {
  bookingRequestId: string;
  currentUserId: string;
  /**
   * Whether this viewer may send and mark read. Organization `operator`s can
   * read the thread but are rejected on both writes, so they get a read-only
   * view rather than controls that can only fail.
   */
  canWrite: boolean;
}

function bannerClasses(tone: PanelBanner["tone"]): string {
  return tone === "error"
    ? "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
    : "rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";
}

export function MessageBubble({
  message,
  mine,
}: {
  message: BookingMessageRecord;
  mine: boolean;
}) {
  return (
    <li
      className={`flex ${mine ? "justify-end" : "justify-start"}`}
      data-testid="booking-message"
      data-mine={mine ? "true" : "false"}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
          mine
            ? "bg-violet-600 text-white"
            : "border border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <p
          className={`mt-2 flex items-center justify-end gap-1 text-[11px] ${
            mine ? "text-violet-100" : "text-slate-400 dark:text-slate-500"
          }`}
        >
          <span>{formatDateTime(message.createdAt) ?? ""}</span>
          {mine && message.readAt ? (
            <span className="inline-flex items-center gap-0.5" title="Seen">
              <Check aria-hidden="true" className="h-3 w-3" />
              Seen
            </span>
          ) : null}
        </p>
      </div>
    </li>
  );
}

export function MessageComposer({
  onSend,
  disabled,
}: {
  onSend: (body: string) => Promise<boolean>;
  disabled: boolean;
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
        onChange={(event) => setValue(event.target.value)}
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
  canWrite,
}: BookingMessagesPanelProps) {
  const [messages, setMessages] = useState<BookingMessageRecord[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<PanelBanner | null>(null);
  const [liveStatus, setLiveStatus] =
    useState<BookingMessageStreamStatus>("connecting");
  const [, startTransition] = useTransition();

  const pageRef = useRef(page);
  pageRef.current = page;

  const loadMessages = useCallback(
    async (targetPage: number, silent = false) => {
      if (!silent) {
        setLoading(true);
      }

      try {
        const result = await bookingMessagesApi.list(bookingRequestId, {
          page: targetPage,
          pageSize: PAGE_SIZE,
        });

        startTransition(() => {
          setMessages(result.messages);
          setPagination(result.pagination);
          setUnreadCount(result.unreadCount);
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
    let handle: BookingMessageStreamHandle | null = null;

    handle = openBookingMessageStream({
      bookingRequestId,
      onStatus: (status) => {
        setLiveStatus(status);

        // The stream is not a durable log: re-sync on every successful
        // (re)connect so anything published while disconnected appears.
        if (status === "open") {
          void loadMessages(pageRef.current, true);
        }
      },
      onEvent: (event) => {
        if (event.type === "message.created") {
          setMessages((previous) =>
            // The same event can arrive twice across a reconnect re-sync.
            previous.some((message) => message.id === event.message.id)
              ? previous
              : [event.message, ...previous],
          );

          if (event.message.authorId !== currentUserId) {
            void markRead();
          }

          return;
        }

        setMessages((previous) =>
          previous.map((message) =>
            message.authorId === currentUserId && !message.readAt
              ? { ...message, readAt: event.readAt }
              : message,
          ),
        );
      },
    });

    return () => handle?.close();
  }, [bookingRequestId, currentUserId, loadMessages, markRead]);

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

        setMessages((previous) =>
          previous.some((message) => message.id === created.id)
            ? previous
            : [created, ...previous],
        );

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
    [bookingRequestId],
  );

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 text-slate-950 dark:text-white">
        <div className="flex items-center gap-2">
          <MessagesSquare aria-hidden="true" className="h-5 w-5" />
          <h2 className="text-base font-semibold tracking-[-0.02em]">
            Messages
          </h2>
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
          <ul className="flex flex-col gap-3">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                mine={message.authorId === currentUserId}
              />
            ))}
          </ul>
        )}
      </div>

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
        <MessageComposer onSend={handleSend} disabled={sending} />
      ) : (
        <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          You have read-only access to this conversation. Ask an organization
          manager to reply.
        </p>
      )}
    </section>
  );
}
