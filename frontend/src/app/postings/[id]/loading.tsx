import { theme } from "@/styles/theme";

export default function Loading() {
  return (
    <main className={theme.marketplace.page}>
      <div className={theme.marketplace.background} aria-hidden="true" />
      <div className={theme.marketplace.orbPrimary} aria-hidden="true" />
      <div className={theme.marketplace.orbSecondary} aria-hidden="true" />

      <div
        className="relative mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)] lg:items-start lg:px-8 lg:py-20"
        aria-hidden="true"
      >
        {/* Main column: hero photo, title, content rows */}
        <div className="space-y-6">
          <div className="h-[22rem] w-full animate-pulse rounded-[2rem] bg-slate-200" />
          <div className="space-y-3">
            <div className="h-9 w-3/4 animate-pulse rounded-full bg-slate-200" />
            <div className="h-5 w-1/2 animate-pulse rounded-full bg-slate-200" />
          </div>
          <div className="space-y-3 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="h-4 w-full animate-pulse rounded-full bg-slate-200" />
            <div className="h-4 w-full animate-pulse rounded-full bg-slate-200" />
            <div className="h-4 w-5/6 animate-pulse rounded-full bg-slate-200" />
            <div className="h-4 w-2/3 animate-pulse rounded-full bg-slate-200" />
          </div>
        </div>

        {/* Side column: booking / pricing panel */}
        <div className="space-y-4 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-950/5 sm:p-8 lg:sticky lg:top-24">
          <div className="h-8 w-1/2 animate-pulse rounded-full bg-slate-200" />
          <div className="h-4 w-3/4 animate-pulse rounded-full bg-slate-200" />
          <div className="mt-4 h-11 w-full animate-pulse rounded-full bg-slate-200" />
          <div className="h-11 w-full animate-pulse rounded-full bg-slate-200" />
        </div>
      </div>

      <span className="sr-only">Loading posting details…</span>
    </main>
  );
}
