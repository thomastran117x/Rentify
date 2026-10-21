"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { adminSecurityApi } from "@/lib/admin-security/api";
import {
  describeUser,
  eventTypeLabel,
  isForbiddenError,
  isNotFoundError,
} from "@/lib/admin-security/format";
import {
  describeDevice,
  formatAbsoluteTime,
  formatRelativeTime,
} from "@/lib/security-activity/format";
import type {
  AdminUserSecuritySummary,
  AuthAuditUserSummary,
} from "@/lib/admin-security/types";
import { OutcomeBadge } from "./admin-security-event-table";

/** Devices listed before "Show all"; test accounts can have hundreds. */
const DEVICES_SHOWN = 5;

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; summary: AdminUserSecuritySummary }
  | { kind: "error"; message: string; retryable: boolean };

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

function formatTime(value: string | null, empty = "Never"): string {
  return value ? formatAbsoluteTime(value) : empty;
}

interface AdminUserSecurityDrawerProps {
  user: AuthAuditUserSummary;
  onClose: () => void;
  onShowEvents: (user: AuthAuditUserSummary) => void;
}

/**
 * A side panel with one account's security summary, opened from the event
 * table. Each open is a fresh read, so the lockout state is live, and each
 * read is recorded by the backend as an `admin.audit_viewed` event.
 */
export function AdminUserSecurityDrawer({
  user,
  onClose,
  onShowEvents,
}: AdminUserSecurityDrawerProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    // The parent keys the drawer by account, so a new account starts in the
    // loading state; Try again resets it before bumping the attempt.
    const controller = new AbortController();

    adminSecurityApi
      .getUserSummary(user.id, controller.signal)
      .then((summary) => {
        if (!controller.signal.aborted) {
          setState({ kind: "ready", summary });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        if (isNotFoundError(error)) {
          setState({
            kind: "error",
            message: "This account no longer exists.",
            retryable: false,
          });
          return;
        }

        if (isForbiddenError(error)) {
          setState({
            kind: "error",
            message: "You no longer have access to account security details.",
            retryable: false,
          });
          return;
        }

        setState({
          kind: "error",
          message: getApiErrorMessage(error, {
            action: "load this account's security summary",
            fallback:
              "We couldn't load this account's security summary. Please try again.",
          }),
          retryable: true,
        });
      });

    return () => controller.abort();
  }, [attempt, user.id]);

  // Focus moves into the panel on open and back to the opener on close.
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;

    if (dialog) {
      (getFocusableElements(dialog)[0] ?? dialog).focus();
    }

    return () => opener?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const dialog = dialogRef.current;

      if (!dialog) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = getFocusableElements(dialog);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-[1px]"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl outline-none dark:bg-slate-900"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">
              Account security
            </p>
            <h2
              id={titleId}
              className="mt-1 truncate text-xl font-semibold text-slate-950 dark:text-white"
            >
              {describeUser(user)}
            </h2>
            {user.username ? (
              <p className="truncate text-sm text-slate-600 dark:text-slate-300">
                {user.email}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account security"
            className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="grid gap-6 px-6 py-6">
          {state.kind === "loading" ? (
            <div
              role="status"
              aria-label="Loading account security"
              className="grid gap-3"
            >
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={index}
                  className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"
                />
              ))}
            </div>
          ) : null}

          {state.kind === "error" ? (
            <div
              role="alert"
              className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-rose-300 px-4 py-4 text-sm text-rose-700 dark:border-rose-800 dark:text-rose-300"
            >
              <p>{state.message}</p>
              {state.retryable ? (
                <button
                  type="button"
                  onClick={() => {
                    setState({ kind: "loading" });
                    setAttempt((value) => value + 1);
                  }}
                  className="rounded-full border border-rose-300 px-4 py-1.5 font-semibold transition hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/40"
                >
                  Try again
                </button>
              ) : null}
            </div>
          ) : null}

          {state.kind === "ready" ? (
            <SummaryBody
              summary={state.summary}
              onShowEvents={() => onShowEvents(user)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SummaryBody({
  summary,
  onShowEvents,
}: {
  summary: AdminUserSecuritySummary;
  onShowEvents: () => void;
}) {
  const { lockout } = summary;
  const [showAllDevices, setShowAllDevices] = useState(false);
  const visibleDevices = showAllDevices
    ? summary.devices
    : summary.devices.slice(0, DEVICES_SHOWN);

  return (
    <>
      <section aria-label="Account" className="grid gap-3 sm:grid-cols-2">
        <Stat label="Status">
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium capitalize text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
            {summary.accountStatus}
          </span>
          <span className="ml-2 text-xs capitalize text-slate-500 dark:text-slate-400">
            {summary.user.role}
          </span>
        </Stat>
        <Stat label="Last sign-in">{formatTime(summary.lastLoginAt)}</Stat>
        <Stat label="Failed sign-ins (24 hours)">
          {summary.failedSignIns.last24Hours}
        </Stat>
        <Stat label="Failed sign-ins (7 days)">
          {summary.failedSignIns.last7Days}
        </Stat>
      </section>

      <section
        aria-label="Sign-in lockout"
        className={`rounded-xl border px-4 py-4 text-sm ${
          lockout.locked
            ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200"
        }`}
      >
        <p className="font-semibold">
          {lockout.locked ? "Password sign-in is locked" : "Not locked"}
        </p>
        <p className="mt-1">
          {lockout.locked && lockout.lockedUntil
            ? `Locked after ${lockout.failedAttempts} failed attempts, until ${formatAbsoluteTime(lockout.lockedUntil)} unless an unlock code is used.`
            : lockout.failedAttempts > 0
              ? `${lockout.failedAttempts} recent failed ${lockout.failedAttempts === 1 ? "attempt" : "attempts"}; the account locks at 5.`
              : "No recent failed password attempts."}
        </p>
      </section>

      <section aria-labelledby="admin-security-devices">
        <h3
          id="admin-security-devices"
          className="text-sm font-semibold text-slate-950 dark:text-white"
        >
          Registered devices
          {summary.devices.length > 0 ? ` (${summary.devices.length})` : ""}
        </h3>
        {summary.devices.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            No registered devices.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {visibleDevices.map((device) => (
              <li key={device.id} className="px-4 py-3 text-sm">
                <p className="font-medium text-slate-900 dark:text-white">
                  {device.browser || device.os
                    ? describeDevice(device)
                    : (device.platform ?? device.type)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Last seen {formatRelativeTime(device.lastSeenAt)}
                  {device.lastIpAddress ? ` from ${device.lastIpAddress}` : ""}
                  {" · "}
                  first seen {formatAbsoluteTime(device.firstSeenAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {summary.devices.length > DEVICES_SHOWN ? (
          <button
            type="button"
            onClick={() => setShowAllDevices((value) => !value)}
            className="mt-2 text-sm font-semibold text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
          >
            {showAllDevices
              ? "Show fewer devices"
              : `Show all ${summary.devices.length} devices`}
          </button>
        ) : null}
      </section>

      <section aria-labelledby="admin-security-recent">
        <div className="flex items-center justify-between gap-3">
          <h3
            id="admin-security-recent"
            className="text-sm font-semibold text-slate-950 dark:text-white"
          >
            Recent events
          </h3>
          <button
            type="button"
            onClick={onShowEvents}
            className="text-sm font-semibold text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
          >
            Show all events
          </button>
        </div>
        {summary.recentEvents.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            No events in the last 90 days.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {summary.recentEvents.map((event) => (
              <li
                key={event.id}
                className="flex items-start justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white">
                    {eventTypeLabel(event.eventType)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    <time
                      dateTime={event.occurredAt}
                      title={formatAbsoluteTime(event.occurredAt)}
                    >
                      {formatRelativeTime(event.occurredAt)}
                    </time>
                    {event.ipAddress ? ` · ${event.ipAddress}` : ""}
                  </p>
                </div>
                <OutcomeBadge outcome={event.outcome} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-800">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
        {children}
      </p>
    </div>
  );
}
