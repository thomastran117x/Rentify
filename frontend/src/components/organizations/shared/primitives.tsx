// Shared presentational primitives for the organization workspace.

import type { ReactNode } from "react";
import { getInitials } from "@/components/organizations/shared/format";

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 shadow-sm dark:border-amber-900/60 dark:bg-slate-900 dark:text-amber-300">
      {children}
    </span>
  );
}

export function Avatar({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl?: string;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={`${name} avatar`}
        className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700"
      />
    );
  }

  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-900 to-sky-700 text-sm font-semibold text-white ring-1 ring-white/20 dark:from-slate-100 dark:to-sky-300 dark:text-slate-950">
      {getInitials(name)}
    </div>
  );
}

export function StatTile({
  eyebrow,
  value,
  detail,
  accent,
}: {
  eyebrow: string;
  value: ReactNode;
  detail: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-[0_16px_40px_-24px_rgba(15,23,42,0.25)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
      <div className={`h-1.5 w-14 rounded-full bg-gradient-to-r ${accent}`} />
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
        {eyebrow}
      </p>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
        {value}
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {detail}
      </p>
    </div>
  );
}

export function SectionCard({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.35)] sm:p-7 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
            {title}
          </h2>
          {description ? (
            <p className="mt-1.5 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function SurfaceNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300">
      {children}
    </div>
  );
}

export function WorkspaceQuickActionCard({
  eyebrow,
  title,
  description,
  meta,
  onClick,
}: {
  eyebrow: string;
  title: string;
  description: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full w-full flex-col rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:bg-white hover:shadow-[0_20px_55px_-35px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-slate-950/35 dark:hover:border-sky-900/60 dark:hover:bg-slate-950/60"
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
        {eyebrow}
      </span>
      <span className="mt-3 text-lg font-semibold tracking-[-0.02em] text-slate-950 transition group-hover:text-sky-700 dark:text-white dark:group-hover:text-sky-300">
        {title}
      </span>
      <span className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
        {description}
      </span>
      <span className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">
        {meta}
      </span>
      <span className="mt-4 text-sm font-semibold text-sky-700 dark:text-sky-300">
        Open section
      </span>
    </button>
  );
}
