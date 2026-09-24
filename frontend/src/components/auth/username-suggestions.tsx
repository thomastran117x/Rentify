"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { authApi } from "@/lib/auth/api";

interface UsernameSuggestionsProps {
  disabled?: boolean;
  onSelect: (username: string) => void;
}

export function UsernameSuggestions({
  disabled = false,
  onSelect,
}: UsernameSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();

    authApi
      .getUsernameSuggestions(3, { signal: abortController.signal })
      .then((result) => {
        if (!abortController.signal.aborted) {
          setSuggestions(result.suggestions);
        }
      })
      .catch((requestError: unknown) => {
        if (
          abortController.signal.aborted ||
          (requestError instanceof Error && requestError.name === "AbortError")
        ) {
          return;
        }

        setError(true);
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      });

    return () => abortController.abort();
  }, [refreshVersion]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Need inspiration?
        </p>

        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setError(false);
            setRefreshVersion((current) => current + 1);
          }}
          disabled={disabled || loading}
          aria-label="Refresh username suggestions"
          title="Refresh"
          className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-slate-500 transition hover:bg-violet-50 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-400 dark:hover:bg-violet-950/40 dark:hover:text-violet-300"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      <div
        className="flex min-h-8 flex-wrap items-center gap-2"
        aria-live="polite"
      >
        {loading && suggestions.length === 0 ? (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            Finding available usernames...
          </span>
        ) : null}

        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSelect(suggestion)}
            disabled={disabled}
            aria-label={`Use username ${suggestion}`}
            className="cursor-pointer rounded-full border border-violet-200 bg-white px-3 py-1 text-sm font-medium text-violet-700 transition hover:border-violet-400 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-900 dark:bg-slate-900 dark:text-violet-300 dark:hover:border-violet-700 dark:hover:bg-violet-950/40"
          >
            {suggestion}
          </button>
        ))}

        {error ? (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            Suggestions are unavailable right now. You can still choose your own
            username.
          </span>
        ) : null}
      </div>
    </div>
  );
}
