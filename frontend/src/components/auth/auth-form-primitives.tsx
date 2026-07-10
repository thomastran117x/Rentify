import type { InputHTMLAttributes, ReactNode } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Field({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: FieldProps) {
  const resolvedId = id ?? props.name;

  return (
    <label htmlFor={resolvedId} className="block space-y-2.5">
      <span className="text-sm font-medium tracking-[-0.01em] text-slate-800 dark:text-slate-100">
        {label}
      </span>
      <input
        {...props}
        id={resolvedId}
        className={`w-full rounded-[1rem] border bg-white dark:bg-slate-900 px-4 py-3.5 text-base text-slate-950 dark:text-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] outline-none transition duration-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-brand-accent focus:ring-4 focus:ring-brand-accent/12 focus-visible:outline-none ${
          error
            ? "border-rose-300 dark:border-rose-800 focus:border-rose-400 focus:ring-rose-100"
            : "border-slate-200 dark:border-slate-800 focus:border-brand-accent focus:ring-brand-accent-soft/70"
        } ${className ?? ""}`}
      />
      {error ? (
        <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
      ) : hint ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{hint}</p>
      ) : null}
    </label>
  );
}

interface BannerProps {
  tone: "error" | "success" | "info";
  children: ReactNode;
}

export function Banner({ tone, children }: BannerProps) {
  const toneClasses = {
    error:
      "border-rose-200 dark:border-rose-900/50 bg-rose-50/80 text-rose-800 dark:text-rose-300",
    success:
      "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/80 text-emerald-800 dark:text-emerald-300",
    info: "border-sky-200 dark:border-sky-900/50 bg-sky-50/80 text-sky-800 dark:text-sky-300",
  } as const;

  return (
    <div
      className={`rounded-[1.15rem] border px-4 py-3 text-sm leading-6 ${toneClasses[tone]}`}
    >
      {children}
    </div>
  );
}

interface SubmitButtonProps {
  pending: boolean;
  children: ReactNode;
}

export function SubmitButton({ pending, children }: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-full bg-brand-accent px-5 py-3.5 text-sm font-semibold text-white shadow-[0_14px_34px_-18px_rgba(37,99,235,0.45)] transition duration-200 hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Please wait..." : children}
    </button>
  );
}

interface EyeIconProps {
  visible: boolean;
}

export function EyeIcon({ visible }: EyeIconProps) {
  if (visible) {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 3l18 18" />
        <path d="M10.58 10.58A2 2 0 0012 14a2 2 0 001.42-.58" />
        <path d="M9.88 5.09A10.94 10.94 0 0112 5c5 0 8.27 4.11 9 5-.35.43-1.3 1.57-2.8 2.7" />
        <path d="M6.61 6.62C4.62 7.9 3.36 9.54 3 10c.73.89 4 5 9 5 1.67 0 3.13-.46 4.39-1.14" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.46 12C3.73 9.57 6.79 5 12 5s8.27 4.57 9.54 7c-1.27 2.43-4.33 7-9.54 7S3.73 14.43 2.46 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
