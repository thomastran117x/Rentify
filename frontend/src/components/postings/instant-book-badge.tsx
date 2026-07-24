import { Zap } from "lucide-react";

export function InstantBookBadge({
  instantBooking,
}: {
  instantBooking?: boolean;
}) {
  if (!instantBooking) {
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 dark:border-sky-900/50 bg-sky-50 dark:bg-sky-950/40 px-2.5 py-1 text-xs font-medium text-sky-700 dark:text-sky-300">
      <Zap className="h-3.5 w-3.5" aria-hidden="true" />
      Instant Book
    </span>
  );
}
