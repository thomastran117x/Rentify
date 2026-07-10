"use client";

import { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PostingAutocompleteInput } from "@/components/postings/posting-autocomplete-input";

const suggestedSearches = [
  "Apartments",
  "Equipment",
  "Studios",
  "Vehicles",
] as const;

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MarketingHeroSearch() {
  const router = useRouter();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const nextQuery = String(formData.get("q") ?? "").trim();

    if (!nextQuery) {
      router.push("/postings");
      return;
    }

    router.push(`/postings?q=${encodeURIComponent(nextQuery)}`);
  }

  function handleSuggestedSearch(value: string) {
    router.push(`/postings?q=${encodeURIComponent(value)}`);
  }

  return (
    <div className="mt-8">
      <form
        onSubmit={handleSubmit}
        className="rounded-[1.75rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-xl shadow-slate-950/5"
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <PostingAutocompleteInput
            label="Search the marketplace"
            placeholder="Search rentals, equipment, spaces, and more"
            shellClassName="group flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 transition duration-200 focus-within:border-violet-500 focus-within:bg-white dark:focus-within:bg-slate-900 focus-within:ring-4 focus-within:ring-violet-500/10"
            icon={<SearchIcon />}
            iconClassName="text-slate-400 dark:text-slate-500 transition group-focus-within:text-violet-600"
            inputClassName="min-w-0 flex-1 bg-transparent text-sm text-slate-900 dark:text-white outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />

          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-2xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-md hover:shadow-violet-600/25"
          >
            Search
          </button>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Popular:
        </span>
        {suggestedSearches.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => handleSuggestedSearch(item)}
            className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 dark:hover:border-violet-800 hover:bg-violet-50 dark:hover:bg-violet-950/40 hover:text-violet-700 dark:hover:text-violet-300"
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
