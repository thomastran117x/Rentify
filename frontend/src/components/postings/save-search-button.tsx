"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BellPlus, Check } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { useErrorToast } from "@/components/errors";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { isApiClientError } from "@/lib/api/types";
import { savedSearchesApi } from "@/lib/saved-searches/api";
import {
  hasSavedSearchFilters,
  readSavedSearchParams,
} from "@/lib/saved-searches/query";
import { theme } from "@/styles/theme";

/**
 * Offers to keep watching the search the visitor is currently looking at.
 *
 * Rendered on the browse page, including when the search returns nothing —
 * that empty result is the moment this feature exists for, and it is also the
 * moment the visitor is most likely to leave and never find out that a
 * matching posting appeared later.
 */
export function SaveSearchButton() {
  const router = useRouter();
  const pathname = usePathname();
  const { status: authStatus } = useAuth();
  const { showError } = useErrorToast();

  const [saving, setSaving] = useState(false);
  /** Query string that was saved, or null when there is nothing to confirm. */
  const [savedSearch, setSavedSearch] = useState<string | null>(null);
  /** Query string of a click made before the session status was known. */
  const pendingSearchRef = useRef<string | null>(null);

  // Adjusted during render rather than in an effect, so it reacts to every
  // navigation rather than to a dependency list. The filter chips are
  // client-side `Link` navigations that change the query but not the pathname,
  // so keying a reset on `pathname` left the confirmation on screen with no
  // button and no way to save the filters the visitor had just switched to.
  // `useSearchParams` is not an option here: it would opt the whole /postings
  // server route into client rendering, which the pagination control documents
  // as the reason it avoids the same hook.
  if (
    savedSearch !== null &&
    typeof window !== "undefined" &&
    window.location.search !== savedSearch
  ) {
    setSavedSearch(null);
  }

  const redirectToLogin = useCallback(
    (search: string) => {
      // Carry the whole search back through the login round trip, or the
      // visitor returns to an empty browse page and has to retype it.
      const next = `${pathname || "/postings"}${search}`;
      router.push(`/login?next=${encodeURIComponent(next)}`);
    },
    [pathname, router],
  );

  const save = useCallback(
    async (
      params: ReturnType<typeof readSavedSearchParams>,
      search: string,
    ) => {
      setSaving(true);

      try {
        await savedSearchesApi.create({ queryParams: params });
        setSavedSearch(search);
      } catch (error) {
        // 409 means this exact search is already saved, which is the outcome
        // the visitor wanted. Reporting it as a failure would read as a bug.
        if (isApiClientError(error) && error.status === 409) {
          setSavedSearch(search);
          return;
        }

        showError({
          title: "Couldn't save this search",
          message: getApiErrorMessage(error, {
            action: "save this search",
            fallback:
              "We couldn't save this search right now. Please try again.",
          }),
          tone: "error",
        });
      } finally {
        setSaving(false);
      }
    },
    [showError],
  );

  /**
   * Replays a click that landed while the session was still resolving.
   *
   * A returning visitor is `loading` until the refresh round trip settles, and
   * the results are already on screen by then. Treating that as anonymous
   * would bounce a signed-in user to the login page, so the intent is held and
   * replayed once the status is known — the same approach the saved-postings
   * context takes for hearts.
   */
  useEffect(() => {
    const pendingSearch = pendingSearchRef.current;

    if (pendingSearch === null || authStatus === "loading") {
      return;
    }

    pendingSearchRef.current = null;

    if (authStatus !== "authenticated") {
      setSaving(false);
      redirectToLogin(pendingSearch);
      return;
    }

    void save(
      readSavedSearchParams(new URLSearchParams(pendingSearch)),
      pendingSearch,
    );
  }, [authStatus, redirectToLogin, save]);

  const handleClick = useCallback(() => {
    // Read at click time, not from state seeded by an effect. The handler only
    // ever runs in the browser, so the live location is authoritative and
    // always populated — holding it in state instead left a window right after
    // hydration where a fast click saw no filters and was told to add one.
    const search = window.location.search;
    const params = readSavedSearchParams(new URLSearchParams(search));

    if (!hasSavedSearchFilters(params)) {
      showError({
        title: "Add a filter first",
        message:
          "A saved search needs at least one filter, otherwise it matches every posting on Rentify.",
        tone: "warning",
      });
      return;
    }

    if (authStatus === "loading") {
      pendingSearchRef.current = search;
      setSaving(true);
      return;
    }

    if (authStatus !== "authenticated") {
      redirectToLogin(search);
      return;
    }

    void save(params, search);
  }, [authStatus, redirectToLogin, save, showError]);

  if (savedSearch !== null) {
    return (
      <span className={theme.marketplace.summaryPill}>
        <Check className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
        Search saved.{" "}
        <a href="/saved/searches" className="underline">
          Manage alerts
        </a>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={saving}
      className={theme.marketplace.paginationButton}
    >
      <BellPlus className="mr-1.5 inline h-4 w-4" aria-hidden="true" />
      {saving ? "Saving..." : "Save this search"}
    </button>
  );
}
