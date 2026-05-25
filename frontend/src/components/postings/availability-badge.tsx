import type { PublicPostingAvailabilityStatus } from "@/lib/postings/public-format";

const availabilityStyles: Record<PublicPostingAvailabilityStatus, string> = {
  available: "border-emerald-200 bg-emerald-50 text-emerald-700",
  limited: "border-amber-200 bg-amber-50 text-amber-700",
  unavailable: "border-slate-200 bg-slate-100 text-slate-500",
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
