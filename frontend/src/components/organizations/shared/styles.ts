// Shared Tailwind class-string constants for the organization workspace.
// Previously duplicated between organization-workspace.tsx and blog-panel.tsx.

export const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition duration-200 placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-400 dark:focus:ring-sky-500/20";

export const primaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm shadow-slate-950/15 transition duration-200 hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-md hover:shadow-slate-950/20 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200";

export const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-900/60 dark:hover:bg-sky-950/30 dark:hover:text-sky-300";

export const dangerButtonClass =
  "inline-flex h-10 items-center justify-center rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 transition duration-200 hover:-translate-y-0.5 hover:bg-rose-50 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/40";

export const rowActionMutedClass =
  "inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-900/60 dark:hover:bg-sky-950/30 dark:hover:text-sky-300";

export const rowActionPrimaryClass =
  "inline-flex h-9 items-center justify-center rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200";

export const fieldLabelClass =
  "text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400";

// Form label used by the blog/content editor (block-level, mixed-case).
export const labelClass =
  "mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200";

// Rounded surface card used by the blog/content editor.
export const cardClass =
  "rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/40";
