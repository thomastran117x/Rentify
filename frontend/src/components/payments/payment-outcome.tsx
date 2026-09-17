import type { ReactNode } from "react";
import { theme } from "@/styles/theme";

export const SECONDARY_OUTCOME_BUTTON_CLASS =
  "inline-flex h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition duration-200 hover:border-violet-200 hover:bg-violet-50/70 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:border-violet-800 dark:hover:bg-violet-950/40";

interface PaymentOutcomePanelProps {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
  /**
   * Embedded panels render inside an existing page (the checkout page) instead
   * of providing their own full-page shell.
   */
  embedded?: boolean;
}

/** The centered result card shared by the checkout and PayPal return pages. */
export function PaymentOutcomePanel({
  icon,
  title,
  description,
  children,
  embedded = false,
}: PaymentOutcomePanelProps) {
  const card = (
    <section
      aria-live="polite"
      className="mx-auto max-w-3xl rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center shadow-xl shadow-slate-950/5 sm:p-10"
    >
      <div className="flex justify-center" aria-hidden="true">
        {icon}
      </div>
      <h1 className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white sm:text-3xl">
        {title}
      </h1>
      <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
        {description}
      </p>
      {children ? (
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          {children}
        </div>
      ) : null}
    </section>
  );

  if (embedded) {
    return card;
  }

  return (
    <main className={theme.marketplace.page}>
      <div className={theme.marketplace.background} aria-hidden="true" />
      <div className={theme.marketplace.container}>{card}</div>
    </main>
  );
}
