import type { PostingStatus } from "@/lib/postings/api";
import {
  EXPIRY_TONE_STYLES,
  describeExpiry,
  formatExpiryDate,
} from "@/lib/postings/expiry";

/**
 * Status chip for a posting's optional expiry date. Renders nothing when the
 * listing never expires, which is the common case.
 */
export function ExpiryChip({
  posting,
}: {
  posting: { status: PostingStatus; expiresAt?: string | null };
}) {
  const expiry = describeExpiry(posting.expiresAt, posting.status);

  if (!expiry) {
    return null;
  }

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${EXPIRY_TONE_STYLES[expiry.tone]}`}
      title={
        posting.expiresAt
          ? `Expires ${formatExpiryDate(posting.expiresAt)}`
          : undefined
      }
    >
      {expiry.label}
    </span>
  );
}
