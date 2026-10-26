"use client";

import {
  describeDevice,
  formatAbsoluteTime,
  formatRelativeTime,
} from "@/lib/security-activity/format";
import {
  OUTCOME_APPEARANCE,
  describeUser,
  eventTypeLabel,
} from "@/lib/admin-security/format";
import type {
  AdminAuthAuditEvent,
  AuthAuditOutcome,
  AuthAuditUserSummary,
} from "@/lib/admin-security/types";

export function OutcomeBadge({ outcome }: { outcome: AuthAuditOutcome }) {
  const appearance = OUTCOME_APPEARANCE[outcome];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${appearance.className}`}
    >
      {appearance.label}
    </span>
  );
}

/** Marks an event suspicious-activity detection acted on. */
export function FlaggedBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
      Flagged
    </span>
  );
}

function UnknownSubject() {
  return (
    <span className="italic text-slate-500 dark:text-slate-400">unknown</span>
  );
}

interface AdminSecurityEventTableProps {
  events: AdminAuthAuditEvent[];
  onOpenUser: (user: AuthAuditUserSummary) => void;
  onFilterByIp: (ipAddress: string) => void;
}

const LINK_BUTTON_CLASS =
  "rounded text-left font-medium text-sky-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 dark:text-sky-300";

export function AdminSecurityEventTable({
  events,
  onOpenUser,
  onFilterByIp,
}: AdminSecurityEventTableProps) {
  return (
    <div className="overflow-x-auto rounded-[1.5rem] border border-slate-200 dark:border-slate-800">
      <table className="min-w-[56rem] w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
        <caption className="sr-only">Sign-in activity</caption>
        <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500 dark:bg-slate-950/60 dark:text-slate-400">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">
              Time
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Event
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Outcome
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Account
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              IP address
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Device
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Acted by
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
          {events.map((event) => (
            <tr key={event.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-200">
                <time
                  dateTime={event.occurredAt}
                  title={formatAbsoluteTime(event.occurredAt)}
                >
                  {formatRelativeTime(event.occurredAt)}
                </time>
              </td>
              <td className="px-4 py-3">
                <p className="font-medium text-slate-900 dark:text-white">
                  {eventTypeLabel(event.eventType)}
                </p>
                <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  {event.eventType}
                  {event.reasonCode ? ` · ${event.reasonCode}` : ""}
                </p>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  <OutcomeBadge outcome={event.outcome} />
                  {event.flagged ? <FlaggedBadge /> : null}
                </div>
              </td>
              <td className="px-4 py-3">
                {event.subject ? (
                  <button
                    type="button"
                    onClick={() => onOpenUser(event.subject!)}
                    className={LINK_BUTTON_CLASS}
                    aria-label={`Open security summary for ${describeUser(event.subject)}`}
                  >
                    {describeUser(event.subject)}
                  </button>
                ) : event.actor ? (
                  // Someone else's action that concerns no account, such as
                  // an administrator's own audit read.
                  <span className="text-slate-400">—</span>
                ) : (
                  <UnknownSubject />
                )}
                {event.subject?.username ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {event.subject.email}
                  </p>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                {event.ipAddress ? (
                  <button
                    type="button"
                    onClick={() => onFilterByIp(event.ipAddress!)}
                    className={LINK_BUTTON_CLASS}
                    title="Show every event from this IP address"
                    aria-label={`Filter by IP address ${event.ipAddress}`}
                  >
                    {event.ipAddress}
                  </button>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                <span title={event.userAgent ?? undefined}>
                  {event.userAgent ? describeDevice(event) : "—"}
                </span>
                {event.deviceId ? (
                  <p className="max-w-[12rem] truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                    {event.deviceId}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                {event.actor ? describeUser(event.actor) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminSecurityEventTableSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading sign-in activity"
      className="grid gap-2 rounded-[1.5rem] border border-slate-200 p-4 dark:border-slate-800"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
        />
      ))}
    </div>
  );
}
