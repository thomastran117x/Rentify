import type { PublicPostingAvailabilityStatus } from "@/lib/postings/public-format";

const availabilityStyles: Record<PublicPostingAvailabilityStatus, string> = {
  available:
    "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300",
  limited:
    "border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300",
  unavailable:
    "border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
};

const availabilityLabels: Record<PublicPostingAvailabilityStatus, string> = {
  available: "Available",
  limited: "Limited",
  unavailable: "Unavailable",
};

export function AvailabilityBadge({
  status,
}: {
  status: PublicPostingAvailabilityStatus;
}) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${availabilityStyles[status]}`}
    >
      {availabilityLabels[status]}
    </span>
  );
}
