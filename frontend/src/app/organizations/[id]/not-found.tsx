import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { theme } from "@/styles/theme";

export default function OrganizationNotFound() {
  return (
    <main className={theme.marketplace.page}>
      <div className={theme.marketplace.background} aria-hidden="true" />
      <div className={theme.marketplace.orbPrimary} aria-hidden="true" />
      <div className={theme.marketplace.orbSecondary} aria-hidden="true" />

      <div className={theme.marketplace.container}>
        <section className="mx-auto max-w-3xl rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center shadow-xl shadow-slate-950/5 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
            Organization not found
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white sm:text-4xl">
            This organization could not be found.
          </h1>
          <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
            The address may be mistyped, or the organization may no longer be
            public. Browse the directory to find what you are looking for.
          </p>
          <div className="mt-7 flex justify-center">
            <Link
              href="/organizations"
              className={theme.marketplace.primaryButton}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to organizations
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
