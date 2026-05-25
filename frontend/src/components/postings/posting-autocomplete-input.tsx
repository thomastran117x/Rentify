"use client";

import {
  startTransition,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  fetchPublicPostingAutocomplete,
  type PostingAutocompleteSuggestion,
} from "@/lib/postings/search";

const AUTOCOMPLETE_DEBOUNCE_MS = 250;
const AUTOCOMPLETE_MIN_QUERY_LENGTH = 2;
const AUTOCOMPLETE_LIMIT = 6;

interface PostingAutocompleteInputProps {
  id?: string;
  name?: string;
  label: string;
  initialValue?: string;
  placeholder: string;
  family?: string;
  subtype?: string;
  shellClassName: string;
  inputClassName: string;
  icon?: ReactNode;
  iconClassName?: string;
  dropdownClassName?: string;
  optionClassName?: string;
  optionActiveClassName?: string;
  loadingClassName?: string;
  onSubmitQuery?: (query: string) => void;
}

const defaultDropdownClassName =
  "absolute left-0 right-0 top-[calc(100%+0.6rem)] z-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-950/10";
const defaultOptionClassName =
  "w-full px-4 py-3 text-left text-sm text-slate-700 transition duration-150 hover:bg-violet-50 hover:text-violet-700";
const defaultOptionActiveClassName = "bg-violet-50 text-violet-700";
const defaultLoadingClassName = "px-4 py-3 text-sm text-slate-500";

export function PostingAutocompleteInput({
  id,
  name = "q",
  label,
  initialValue = "",
  placeholder,
  family,
  subtype,
  shellClassName,
  inputClassName,
  icon,
  iconClassName,
  dropdownClassName = defaultDropdownClassName,
  optionClassName = defaultOptionClassName,
  optionActiveClassName = defaultOptionActiveClassName,
  loadingClassName = defaultLoadingClassName,
  onSubmitQuery,
}: PostingAutocompleteInputProps) {
  const generatedId = useId();
  const inputId = id ?? `posting-autocomplete-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialValue);
  const [suggestions, setSuggestions] = useState<
    PostingAutocompleteSuggestion[]
  >([]);
  const [isFocused, setIsFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  useEffect(() => {
    setQuery(initialValue);
  }, [initialValue]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsFocused(false);
        setHighlightedIndex(-1);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < AUTOCOMPLETE_MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setIsLoading(false);
      setHighlightedIndex(-1);
      return;
    }

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setIsLoading(true);

      fetchPublicPostingAutocomplete(
        {
          q: trimmedQuery,
          family,
          subtype,
          limit: AUTOCOMPLETE_LIMIT,
        },
        {
          signal: abortController.signal,
        },
      )
        .then((result) => {
          if (abortController.signal.aborted) {
            return;
          }

          startTransition(() => {
            setSuggestions(result.suggestions);
            setIsLoading(false);
            setHighlightedIndex(-1);
          });
        })
        .catch((error) => {
          if (
            abortController.signal.aborted ||
            (error instanceof Error && error.name === "AbortError")
          ) {
            return;
          }

          startTransition(() => {
            setSuggestions([]);
            setIsLoading(false);
            setHighlightedIndex(-1);
          });
        });
    }, AUTOCOMPLETE_DEBOUNCE_MS);

    return () => {
      abortController.abort();
      window.clearTimeout(timeoutId);
    };
  }, [family, query, subtype]);

  const showDropdown =
    isFocused &&
    query.trim().length >= AUTOCOMPLETE_MIN_QUERY_LENGTH &&
    (isLoading || suggestions.length > 0);

  function submitQuery(nextQuery: string) {
    const trimmedQuery = nextQuery.trim();
    setQuery(trimmedQuery);
    setSuggestions([]);
    setHighlightedIndex(-1);
    setIsFocused(false);

    if (onSubmitQuery) {
      onSubmitQuery(trimmedQuery);
      return;
    }

    window.requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.value = trimmedQuery;
        inputRef.current.form?.requestSubmit();
      }
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown || suggestions.length === 0) {
      if (event.key === "Enter" && query.trim()) {
        event.preventDefault();
        submitQuery(query);
        return;
      }

      if (event.key === "Escape") {
        setIsFocused(false);
        setHighlightedIndex(-1);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex(
        (currentIndex) => (currentIndex + 1) % suggestions.length,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((currentIndex) =>
        currentIndex <= 0 ? suggestions.length - 1 : currentIndex - 1,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      submitQuery(suggestions[highlightedIndex]?.value ?? query);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsFocused(false);
      setHighlightedIndex(-1);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={inputId} className={shellClassName}>
        {icon ? <span className={iconClassName}>{icon}</span> : null}
        <span className="sr-only">{label}</span>
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          name={name}
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listboxId : undefined}
          aria-activedescendant={
            showDropdown && highlightedIndex >= 0
              ? `${inputId}-option-${highlightedIndex}`
              : undefined
          }
          className={inputClassName}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsFocused(true);
            setHighlightedIndex(-1);
          }}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
        />
      </label>

      {showDropdown ? (
        <div className={dropdownClassName}>
          {isLoading ? (
            <div className={loadingClassName}>Finding suggestions...</div>
          ) : (
            <ul id={listboxId} role="listbox">
              {suggestions.map((suggestion, index) => {
                const active = index === highlightedIndex;

                return (
                  <li
                    key={`${suggestion.kind}-${suggestion.value}`}
                    id={`${inputId}-option-${index}`}
                    role="option"
                    aria-selected={active}
                  >
                    <button
                      type="button"
                      className={`${optionClassName} ${active ? optionActiveClassName : ""}`.trim()}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => submitQuery(suggestion.value)}
                    >
                      {suggestion.value}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
