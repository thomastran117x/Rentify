"use client";

import { useId, useState, type FormEvent } from "react";
import { isValidDateInput } from "@/lib/security-activity/format";
import {
  EMPTY_FILTERS,
  EVENT_TYPE_GROUPS,
  eventTypeLabel,
  hasInvertedDateRange,
  type AdminSecurityFilters,
} from "@/lib/admin-security/format";
import type {
  AuthAuditEventType,
  AuthAuditOutcome,
} from "@/lib/admin-security/types";

const OUTCOME_OPTIONS: Array<{ value: AuthAuditOutcome | ""; label: string }> =
  [
    { value: "", label: "Any outcome" },
    { value: "success", label: "Succeeded" },
    { value: "failure", label: "Failed" },
    { value: "blocked", label: "Blocked" },
  ];

const FIELD_CLASS =
  "h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950 aria-[invalid=true]:border-rose-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:[color-scheme:dark] dark:focus:border-slate-400";

const LABEL_CLASS = "grid gap-1.5 text-sm";
const LABEL_TEXT_CLASS = "font-medium text-slate-700 dark:text-slate-200";

interface AdminSecurityFilterBarProps {
  filters: AdminSecurityFilters;
  onApply: (filters: AdminSecurityFilters) => void;
  busy: boolean;
}

/**
 * Edits a draft of the filters and applies it on submit, so typing an email
 * does not fire one search, and one audit record, per keystroke. Clear
 * applies at once.
 */
export function AdminSecurityFilterBar({
  filters,
  onApply,
  busy,
}: AdminSecurityFilterBarProps) {
  // The parent keys this form by the applied filters, so a filter applied
  // from elsewhere (a row's IP, the drawer, the back button) starts a fresh
  // draft.
  const [draft, setDraft] = useState(filters);
  const dateErrorId = useId();

  const invertedRange = hasInvertedDateRange(draft);
  const invalidDate =
    !isValidDateInput(draft.fromDate) || !isValidDateInput(draft.toDate);
  const dateError = invertedRange
    ? "The To date must be on or after the From date."
    : invalidDate
      ? "Enter a complete date."
      : null;

  function update<TKey extends keyof AdminSecurityFilters>(
    key: TKey,
    value: AdminSecurityFilters[TKey],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function toggleEventType(eventType: AuthAuditEventType, checked: boolean) {
    setDraft((current) => ({
      ...current,
      eventTypes: checked
        ? [...current.eventTypes, eventType]
        : current.eventTypes.filter((value) => value !== eventType),
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (dateError) {
      return;
    }

    onApply(draft);
  }

  function handleClear() {
    setDraft(EMPTY_FILTERS);
    onApply(EMPTY_FILTERS);
  }

  const eventTypeSummary =
    draft.eventTypes.length === 0
      ? "All event types"
      : draft.eventTypes.length === 1
        ? eventTypeLabel(draft.eventTypes[0]!)
        : `${draft.eventTypes.length} event types`;

  return (
    <form
      aria-label="Filter sign-in activity"
      onSubmit={handleSubmit}
      className="grid gap-4 rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>User</span>
          <input
            value={draft.user}
            onChange={(event) => update("user", event.target.value)}
            placeholder="Email or username"
            autoComplete="off"
            spellCheck={false}
            maxLength={255}
            className={FIELD_CLASS}
          />
        </label>

        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>IP address</span>
          <input
            value={draft.ip}
            onChange={(event) => update("ip", event.target.value)}
            placeholder="203.0.113.24"
            autoComplete="off"
            spellCheck={false}
            maxLength={45}
            className={FIELD_CLASS}
          />
        </label>

        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>Outcome</span>
          <select
            value={draft.outcome}
            onChange={(event) =>
              update("outcome", event.target.value as AuthAuditOutcome | "")
            }
            className={FIELD_CLASS}
          >
            {OUTCOME_OPTIONS.map((option) => (
              <option key={option.value || "any"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>From</span>
          <input
            type="date"
            value={draft.fromDate}
            onChange={(event) => update("fromDate", event.target.value)}
            aria-invalid={dateError ? true : undefined}
            aria-describedby={dateError ? dateErrorId : undefined}
            className={FIELD_CLASS}
          />
        </label>

        <label className={LABEL_CLASS}>
          <span className={LABEL_TEXT_CLASS}>To</span>
          <input
            type="date"
            value={draft.toDate}
            onChange={(event) => update("toDate", event.target.value)}
            aria-invalid={dateError ? true : undefined}
            aria-describedby={dateError ? dateErrorId : undefined}
            className={FIELD_CLASS}
          />
        </label>

        <div className="grid gap-1.5 text-sm sm:col-span-2 lg:col-span-3">
          <span className={LABEL_TEXT_CLASS}>Event type</span>
          <details>
            <summary
              className={`${FIELD_CLASS} flex cursor-pointer sm:max-w-xs list-none items-center justify-between [&::-webkit-details-marker]:hidden`}
            >
              <span className="truncate">{eventTypeSummary}</span>
              <span aria-hidden className="ml-2 text-slate-400">
                ▾
              </span>
            </summary>
            {/* Expands in place rather than floating, so it never covers the
                actions below it. */}
            <fieldset className="mt-2 grid gap-4 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-4">
              <legend className="sr-only">Event types</legend>
              {EVENT_TYPE_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                    {group.label}
                  </p>
                  {group.types.map((eventType) => (
                    <label
                      key={eventType}
                      className="flex items-center gap-2 py-0.5 text-sm text-slate-700 dark:text-slate-200"
                    >
                      <input
                        type="checkbox"
                        checked={draft.eventTypes.includes(eventType)}
                        onChange={(event) =>
                          toggleEventType(eventType, event.target.checked)
                        }
                        disabled={
                          !draft.eventTypes.includes(eventType) &&
                          draft.eventTypes.length >= 10
                        }
                      />
                      {eventTypeLabel(eventType)}
                    </label>
                  ))}
                </div>
              ))}
            </fieldset>
          </details>
        </div>
      </div>

      {dateError ? (
        <p
          id={dateErrorId}
          role="alert"
          className="text-sm text-rose-700 dark:text-rose-300"
        >
          {dateError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy || Boolean(dateError)}
          className="inline-flex h-10 items-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={handleClear}
          disabled={busy}
          className="inline-flex h-10 items-center rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Clear
        </button>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Without dates, the last 7 days are searched. Ranges are limited to 90
          days.
        </p>
      </div>
    </form>
  );
}
