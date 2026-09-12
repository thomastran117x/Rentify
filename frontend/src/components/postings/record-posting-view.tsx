"use client";

import { useEffect, useRef } from "react";
import { useRecentlyViewed } from "@/components/postings/recently-viewed-context";

/**
 * Records that the visitor opened a posting, then renders nothing.
 *
 * Mounted from the posting detail page rather than folded into
 * PostingDetailClient, so that component's test surface is untouched and the
 * recording concern stays in one small file.
 */
export function RecordPostingView({ postingId }: { postingId: string }) {
  const { recordView } = useRecentlyViewed();

  // React invokes effects twice in development strict mode, and `recordView`
  // is not free (a local write plus a request), so the posting this component
  // has already recorded is remembered rather than recorded again.
  const recordedPostingIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (recordedPostingIdRef.current === postingId) {
      return;
    }

    recordedPostingIdRef.current = postingId;
    recordView(postingId);
  }, [postingId, recordView]);

  return null;
}
