"use client";

export interface AuthFormStep {
  id: string;
  title: string;
  blurb: string;
}

interface AuthFormStepsProps {
  steps: readonly AuthFormStep[];
  currentStep: number;
  /** Highest step the user has unlocked; later steps stay disabled. */
  maxStepReached: number;
  onStepChange: (step: number) => void;
  navLabel: string;
}

/**
 * Progress header for a short auth wizard: a counter, the current step's
 * heading, a progress bar, and pills for jumping back to a completed step.
 *
 * This mirrors the posting wizard's stepper, deliberately as a separate small
 * component rather than by generalising that 2,500-line workspace.
 */
export function AuthFormSteps({
  steps,
  currentStep,
  maxStepReached,
  onStepChange,
  navLabel,
}: AuthFormStepsProps) {
  const step = steps[currentStep];

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
        Step {currentStep + 1} of {steps.length}
      </p>
      <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">
        {step.title}
      </h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {step.blurb}
      </p>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all"
          style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
        />
      </div>

      <nav className="mt-3 flex flex-wrap gap-2" aria-label={navLabel}>
        {steps.map((item, index) => {
          const reached = index <= maxStepReached;
          const state =
            index === currentStep
              ? "current"
              : index < currentStep
                ? "done"
                : "upcoming";

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => reached && onStepChange(index)}
              disabled={!reached}
              aria-current={index === currentStep ? "step" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                state === "current"
                  ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                  : state === "done"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
              } ${reached ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
            >
              <span aria-hidden="true">
                {state === "done" ? "✓" : index + 1}
              </span>
              {item.title}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
