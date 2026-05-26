"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { isModeratorRole } from "@/lib/auth/roles";
import {
  reportsApi,
  type ContentReportDetailRecord,
  type ListContentReportsFilters,
  type ListContentReportsResult,
  type ReportReasonCode,
  type ReportResolutionCode,
  type ReportStatus,
  type ReportSubjectType,
} from "@/lib/reports/api";

const STATUS_OPTIONS: Array<{ label: string; value?: ReportStatus }> = [
  { label: "All statuses" },
  { label: "Open", value: "open" },
  { label: "Under review", value: "under_review" },
  { label: "Resolved", value: "resolved" },
  { label: "Dismissed", value: "dismissed" },
];

const SUBJECT_TYPE_OPTIONS: Array<{
  label: string;
  value?: ReportSubjectType;
}> = [
  { label: "All subjects" },
  { label: "Posting", value: "posting" },
  { label: "Review", value: "posting_review" },
  { label: "User", value: "user" },
];

const REASON_OPTIONS: Array<{ label: string; value?: ReportReasonCode }> = [
  { label: "All reasons" },
  { label: "Spam", value: "spam" },
  { label: "Fraud or scam", value: "fraud_or_scam" },
  { label: "Harassment or hate", value: "harassment_or_hate" },
  { label: "Sexual content", value: "sexual_content" },
  { label: "Violence or threats", value: "violence_or_threats" },
  { label: "Illegal or prohibited", value: "illegal_or_prohibited" },
  { label: "Impersonation", value: "impersonation" },
  { label: "Misleading information", value: "misleading_information" },
  { label: "Review manipulation", value: "review_manipulation" },
  { label: "Other", value: "other" },
];

const RESOLUTION_OPTIONS: Array<{
  label: string;
  value: ReportResolutionCode;
}> = [
  { label: "Action taken", value: "action_taken" },
  { label: "No violation", value: "no_violation" },
  { label: "Duplicate", value: "duplicate" },
  { label: "Insufficient information", value: "insufficient_information" },
];

function humanizeValue(value: string): string {
  return value
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value?: string): string | null {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ModerationWorkspace() {
  const router = useRouter();
  const { status, session } = useAuth();
  const [filters, setFilters] = useState<ListContentReportsFilters>({
    page: 1,
    pageSize: 20,
    sort: "newest",
  });
  const [queue, setQueue] = useState<ListContentReportsResult | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContentReportDetailRecord | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolutionCode, setResolutionCode] =
    useState<ReportResolutionCode>("action_taken");
  const [resolutionSummary, setResolutionSummary] = useState("");
  const [note, setNote] = useState("");
  const [mutationPending, setMutationPending] = useState(false);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login?next=%2Fmoderation");
    }
  }, [router, status]);

  useEffect(() => {
    if (
      status !== "authenticated" ||
      !session ||
      !isModeratorRole(session.user.role)
    ) {
      return;
    }

    let active = true;
    setLoadingQueue(true);
    setError(null);

    void reportsApi
      .listModeration(filters)
      .then((result) => {
        if (!active) {
          return;
        }

        startTransition(() => {
          setQueue(result);
          if (!selectedReportId) {
            setSelectedReportId(result.reports[0]?.id ?? null);
          } else if (
            !result.reports.some((report) => report.id === selectedReportId)
          ) {
            setSelectedReportId(result.reports[0]?.id ?? null);
          }
        });
      })
      .catch((nextError) => {
        if (active) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Reports could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoadingQueue(false);
        }
      });

    return () => {
      active = false;
    };
  }, [filters, selectedReportId, session, status]);

  useEffect(() => {
    if (
      !selectedReportId ||
      status !== "authenticated" ||
      !session ||
      !isModeratorRole(session.user.role)
    ) {
      return;
    }

    let active = true;
    setLoadingDetail(true);

    void reportsApi
      .getModerationReport(selectedReportId)
      .then((result) => {
        if (!active) {
          return;
        }

        setDetail(result);
        setResolutionCode(result.resolutionCode ?? "action_taken");
        setResolutionSummary(result.resolutionSummary ?? "");
        setNote("");
      })
      .catch((nextError) => {
        if (active) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Report details could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoadingDetail(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedReportId, session, status]);

  async function refreshSelectedReport(reportId: string) {
    const [nextQueue, nextDetail] = await Promise.all([
      reportsApi.listModeration(filters),
      reportsApi.getModerationReport(reportId),
    ]);
    setQueue(nextQueue);
    setDetail(nextDetail);
  }

  async function handleAssignToSelf() {
    if (!detail) {
      return;
    }

    setMutationPending(true);
    setMessage(null);
    setError(null);

    try {
      await reportsApi.assign(detail.id, {});
      await refreshSelectedReport(detail.id);
      setMessage("Report assigned.");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Assignment could not be updated.",
      );
    } finally {
      setMutationPending(false);
    }
  }

  async function handleUnassign() {
    if (!detail) {
      return;
    }

    setMutationPending(true);
    setMessage(null);
    setError(null);

    try {
      await reportsApi.assign(detail.id, {
        assignedModeratorId: null,
      });
      await refreshSelectedReport(detail.id);
      setMessage("Report unassigned.");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Assignment could not be updated.",
      );
    } finally {
      setMutationPending(false);
    }
  }

  async function handleStatusUpdate(nextStatus: ReportStatus) {
    if (!detail) {
      return;
    }

    setMutationPending(true);
    setMessage(null);
    setError(null);

    try {
      await reportsApi.updateStatus(detail.id, {
        status: nextStatus,
        resolutionCode:
          nextStatus === "resolved" || nextStatus === "dismissed"
            ? resolutionCode
            : undefined,
        resolutionSummary: resolutionSummary.trim() || undefined,
        note: note.trim() || undefined,
      });
      await refreshSelectedReport(detail.id);
      setMessage(`Report moved to ${humanizeValue(nextStatus).toLowerCase()}.`);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Status could not be updated.",
      );
    } finally {
      setMutationPending(false);
    }
  }

  if (status === "loading" || (status === "authenticated" && !session)) {
    return <WorkspaceShell>Loading moderation workspace...</WorkspaceShell>;
  }

  if (
    status === "authenticated" &&
    session &&
    !isModeratorRole(session.user.role)
  ) {
    return (
      <WorkspaceShell>
        <div className="rounded-[1.8rem] border border-rose-200 bg-rose-50 px-6 py-6 text-sm text-rose-800">
          Moderation access is limited to moderators and admins.
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell>
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <div className="grid min-h-[72vh] gap-0 lg:grid-cols-[26rem_minmax(0,1fr)]">
          <aside className="border-b border-slate-200 bg-slate-50/70 p-5 lg:border-b-0 lg:border-r">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                Moderation
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-slate-950">
                Report queue
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Search reports, filter the queue, and open the full timeline in
                one place.
              </p>
            </div>

            <div className="mt-5 grid gap-3">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Search</span>
                <input
                  value={filters.q ?? ""}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      q: event.target.value || undefined,
                      page: 1,
                    }))
                  }
                  placeholder="Title, description, or user"
                  className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                />
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Status</span>
                <select
                  value={filters.status ?? ""}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      status: (event.target.value || undefined) as
                        | ReportStatus
                        | undefined,
                      page: 1,
                    }))
                  }
                  className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option
                      key={option.value ?? "all"}
                      value={option.value ?? ""}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Subject</span>
                <select
                  value={filters.subjectType ?? ""}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      subjectType: (event.target.value || undefined) as
                        | ReportSubjectType
                        | undefined,
                      page: 1,
                    }))
                  }
                  className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                >
                  {SUBJECT_TYPE_OPTIONS.map((option) => (
                    <option
                      key={option.value ?? "all"}
                      value={option.value ?? ""}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Reason</span>
                <select
                  value={filters.reasonCode ?? ""}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      reasonCode: (event.target.value || undefined) as
                        | ReportReasonCode
                        | undefined,
                      page: 1,
                    }))
                  }
                  className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                >
                  {REASON_OPTIONS.map((option) => (
                    <option
                      key={option.value ?? "all"}
                      value={option.value ?? ""}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              Source:{" "}
              <span className="font-semibold text-slate-950">
                {queue?.source ?? "..."}
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              {loadingQueue ? (
                <p className="text-sm text-slate-500">Loading reports...</p>
              ) : queue && queue.reports.length > 0 ? (
                queue.reports.map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => setSelectedReportId(report.id)}
                    className={`rounded-[1.4rem] border px-4 py-4 text-left transition ${
                      selectedReportId === report.id
                        ? "border-sky-300 bg-sky-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">
                          {report.title}
                        </p>
                        <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                          {humanizeValue(report.subjectType)} ·{" "}
                          {humanizeValue(report.reasonCode)}
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {humanizeValue(report.status)}
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">
                      {report.description}
                    </p>
                  </button>
                ))
              ) : (
                <div className="rounded-[1.4rem] border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                  No reports match these filters.
                </div>
              )}
            </div>
          </aside>

          <section className="p-6">
            {message ? (
              <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {message}
              </div>
            ) : null}
            {error ? (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {error}
              </div>
            ) : null}

            {loadingDetail ? (
              <p className="text-sm text-slate-500">Loading report detail...</p>
            ) : detail ? (
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_22rem]">
                <div className="space-y-6">
                  <section className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          {humanizeValue(detail.subjectType)}
                        </p>
                        <h2 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950">
                          {detail.title}
                        </h2>
                        <p className="mt-3 text-sm leading-7 text-slate-600">
                          {detail.description}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">
                          {humanizeValue(detail.status)}
                        </span>
                        <span className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">
                          {humanizeValue(detail.reasonCode)}
                        </span>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-5 shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-950">
                      Subject snapshot
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      {detail.subjectSnapshot.summaryText}
                    </p>
                  </section>

                  <section className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-5 shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-950">
                      Timeline
                    </h3>
                    <div className="mt-4 grid gap-3">
                      {detail.events.map((event) => (
                        <div
                          key={event.id}
                          className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3"
                        >
                          <p className="text-sm font-semibold text-slate-950">
                            {humanizeValue(event.eventType)}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            {event.actor.username ?? event.actor.email} ·{" "}
                            {formatDateTime(event.createdAt)}
                          </p>
                          {event.note ? (
                            <p className="mt-2 text-sm leading-6 text-slate-600">
                              {event.note}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <div className="space-y-6">
                  <section className="rounded-[1.8rem] border border-slate-200 bg-slate-50 px-5 py-5">
                    <h3 className="text-lg font-semibold text-slate-950">
                      Moderation actions
                    </h3>
                    <div className="mt-4 grid gap-3">
                      <button
                        type="button"
                        onClick={() => void handleAssignToSelf()}
                        disabled={mutationPending}
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Assign to me
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUnassign()}
                        disabled={mutationPending}
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Unassign
                      </button>
                    </div>

                    <div className="mt-5 grid gap-3">
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-slate-700">
                          Resolution code
                        </span>
                        <select
                          value={resolutionCode}
                          onChange={(event) =>
                            setResolutionCode(
                              event.target.value as ReportResolutionCode,
                            )
                          }
                          className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                        >
                          {RESOLUTION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-slate-700">
                          Resolution summary
                        </span>
                        <textarea
                          value={resolutionSummary}
                          onChange={(event) =>
                            setResolutionSummary(event.target.value)
                          }
                          rows={4}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                        />
                      </label>

                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-slate-700">
                          Internal note
                        </span>
                        <textarea
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          rows={3}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                        />
                      </label>
                    </div>

                    <div className="mt-5 grid gap-3">
                      <button
                        type="button"
                        onClick={() => void handleStatusUpdate("under_review")}
                        disabled={mutationPending}
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Move to under review
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleStatusUpdate("resolved")}
                        disabled={mutationPending}
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Resolve report
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleStatusUpdate("dismissed")}
                        disabled={mutationPending}
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Dismiss report
                      </button>
                    </div>
                  </section>

                  <section className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-5 shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-950">
                      Snapshot
                    </h3>
                    <div className="mt-4 grid gap-2 text-sm text-slate-600">
                      <p>
                        Reporter:{" "}
                        <span className="font-medium text-slate-950">
                          {detail.reporter.username ?? detail.reporter.email}
                        </span>
                      </p>
                      <p>
                        Assignee:{" "}
                        <span className="font-medium text-slate-950">
                          {detail.assignedModerator?.username ??
                            detail.assignedModerator?.email ??
                            "Unassigned"}
                        </span>
                      </p>
                      <p>
                        Created:{" "}
                        <span className="font-medium text-slate-950">
                          {formatDateTime(detail.createdAt)}
                        </span>
                      </p>
                      <p>
                        Updated:{" "}
                        <span className="font-medium text-slate-950">
                          {formatDateTime(detail.updatedAt)}
                        </span>
                      </p>
                      {detail.reviewedAt ? (
                        <p>
                          Reviewed:{" "}
                          <span className="font-medium text-slate-950">
                            {formatDateTime(detail.reviewedAt)}
                          </span>
                        </p>
                      ) : null}
                    </div>
                  </section>
                </div>
              </div>
            ) : (
              <div className="rounded-[1.8rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-sm text-slate-500">
                Pick a report from the queue to inspect the full record.
              </div>
            )}
          </section>
        </div>
      </section>
    </WorkspaceShell>
  );
}

function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[calc(100vh-5.5rem)] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_28%),linear-gradient(180deg,_#f8fafc,_#ffffff)] px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-7xl">{children}</div>
    </main>
  );
}
