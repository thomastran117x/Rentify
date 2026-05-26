"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import {
  reportsApi,
  type ReportReasonCode,
  type ReportSubjectType,
} from "@/lib/reports/api";

const REPORT_REASON_OPTIONS: Array<{
  value: ReportReasonCode;
  label: string;
}> = [
  { value: "spam", label: "Spam" },
  { value: "fraud_or_scam", label: "Fraud or scam" },
  { value: "harassment_or_hate", label: "Harassment or hate" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "violence_or_threats", label: "Violence or threats" },
  { value: "illegal_or_prohibited", label: "Illegal or prohibited" },
  { value: "impersonation", label: "Impersonation" },
  { value: "misleading_information", label: "Misleading information" },
  { value: "review_manipulation", label: "Review manipulation" },
  { value: "other", label: "Other" },
];

function getReasonLabel(reasonCode: ReportReasonCode): string {
  return (
    REPORT_REASON_OPTIONS.find((option) => option.value === reasonCode)
      ?.label ?? "Other"
  );
}

interface ReportDialogProps {
  subjectType: ReportSubjectType;
  subjectId: string;
  subjectLabel: string;
  triggerLabel: string;
  className?: string;
}

export function ReportDialog({
  subjectType,
  subjectId,
  subjectLabel,
  triggerLabel,
  className,
}: ReportDialogProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useAuth();
  const [open, setOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState<ReportReasonCode>("spam");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setReasonCode("spam");
    setTitle("");
    setDescription("");
    setError(null);
  }

  function handleTriggerClick() {
    if (status === "anonymous") {
      router.push(`/login?next=${encodeURIComponent(pathname || "/")}`);
      return;
    }

    setOpen(true);
    setSuccessMessage(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();

    if (trimmedTitle.length < 3 || trimmedTitle.length > 120) {
      setError("Title must be between 3 and 120 characters.");
      return;
    }

    if (trimmedDescription.length < 10 || trimmedDescription.length > 2000) {
      setError("Description must be between 10 and 2000 characters.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await reportsApi.create({
        subjectType,
        subjectId,
        reasonCode,
        title: trimmedTitle,
        description: trimmedDescription,
      });
      resetForm();
      setOpen(false);
      setSuccessMessage(
        `${subjectLabel} was reported for ${getReasonLabel(reasonCode).toLowerCase()}.`,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "The report could not be submitted.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="space-y-2">
        <button
          type="button"
          onClick={handleTriggerClick}
          className={
            className ??
            "inline-flex h-10 items-center justify-center rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
          }
        >
          {triggerLabel}
        </button>
        {successMessage ? (
          <p className="text-sm text-emerald-700">{successMessage}</p>
        ) : null}
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8">
          <div className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_30px_100px_rgba(15,23,42,0.28)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">
                  Safety report
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">
                  Report {subjectLabel.toLowerCase()}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Share enough context for a moderator to review what happened.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
              <label className="grid gap-2 text-sm text-slate-700">
                <span className="font-medium">Reason</span>
                <select
                  value={reasonCode}
                  onChange={(event) =>
                    setReasonCode(event.target.value as ReportReasonCode)
                  }
                  className="h-11 rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                >
                  {REPORT_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm text-slate-700">
                <span className="font-medium">Title</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="h-11 rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                  maxLength={120}
                  placeholder="Short summary of the issue"
                />
              </label>

              <label className="grid gap-2 text-sm text-slate-700">
                <span className="font-medium">Description</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={6}
                  maxLength={2000}
                  className="rounded-xl border border-slate-300 px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                  placeholder="Describe the behavior, context, and why it violates the rules."
                />
              </label>

              {error ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setError(null);
                  }}
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Submitting..." : "Submit report"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
