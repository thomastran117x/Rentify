import type { ReactNode } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { cx } from "./utils";

export type ErrorTone = "info" | "warning" | "error";

interface ErrorToneDefinition {
  label: string;
  panel: string;
  panelText: string;
  mutedText: string;
  iconShell: string;
  iconText: string;
  primaryButton: string;
  secondaryButton: string;
  issueButton: string;
  issueButtonActive: string;
  fieldText: string;
}

const ERROR_TONE_DEFINITIONS: Record<ErrorTone, ErrorToneDefinition> = {
  info: {
    label: "Info",
    panel:
      "border-sky-200 dark:border-sky-900/50 bg-sky-50 dark:bg-sky-950/40 text-sky-950 dark:text-sky-100",
    panelText: "text-sky-950 dark:text-sky-100",
    mutedText: "text-sky-900/80 dark:text-sky-200",
    iconShell:
      "border border-sky-200 dark:border-sky-900/50 bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300",
    iconText: "text-sky-700 dark:text-sky-300",
    primaryButton:
      "bg-sky-700 text-white hover:bg-sky-800 focus-visible:ring-sky-200",
    secondaryButton:
      "border border-sky-200 dark:border-sky-900/50 bg-white dark:bg-slate-900 text-sky-950 dark:text-sky-100 hover:bg-sky-100 focus-visible:ring-sky-200",
    issueButton:
      "border-sky-200 dark:border-sky-900/50 bg-white/85 dark:bg-slate-900/70 text-sky-950 dark:text-sky-100 hover:bg-sky-100 focus-visible:ring-sky-200",
    issueButtonActive:
      "border-sky-300 dark:border-sky-800 bg-sky-100 dark:bg-sky-950/40 text-sky-950 dark:text-sky-100 ring-sky-200",
    fieldText: "text-sky-800 dark:text-sky-300",
  },
  warning: {
    label: "Warning",
    panel:
      "border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100",
    panelText: "text-amber-950 dark:text-amber-100",
    mutedText: "text-amber-900/80 dark:text-amber-200",
    iconShell:
      "border border-amber-200 dark:border-amber-900/50 bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300",
    iconText: "text-amber-700 dark:text-amber-300",
    primaryButton:
      "bg-amber-400 text-slate-950 hover:bg-amber-500 focus-visible:ring-amber-200",
    secondaryButton:
      "border border-amber-200 dark:border-amber-900/50 bg-white dark:bg-slate-900 text-amber-950 dark:text-amber-100 hover:bg-amber-100 focus-visible:ring-amber-200",
    issueButton:
      "border-amber-200 dark:border-amber-900/50 bg-white/85 dark:bg-slate-900/70 text-amber-950 dark:text-amber-100 hover:bg-amber-100 focus-visible:ring-amber-200",
    issueButtonActive:
      "border-amber-300 dark:border-amber-800 bg-amber-100 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100 ring-amber-200",
    fieldText: "text-amber-900 dark:text-amber-200",
  },
  error: {
    label: "Error",
    panel:
      "border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 text-rose-950 dark:text-rose-100",
    panelText: "text-rose-950 dark:text-rose-100",
    mutedText: "text-rose-900/80 dark:text-rose-200",
    iconShell:
      "border border-rose-200 dark:border-rose-900/50 bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-300",
    iconText: "text-rose-700 dark:text-rose-300",
    primaryButton:
      "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-200",
    secondaryButton:
      "border border-rose-200 dark:border-rose-900/50 bg-white dark:bg-slate-900 text-rose-950 dark:text-rose-100 hover:bg-rose-100 dark:hover:bg-rose-950/40 focus-visible:ring-rose-200",
    issueButton:
      "border-rose-200 dark:border-rose-900/50 bg-white/85 dark:bg-slate-900/70 text-rose-950 dark:text-rose-100 hover:bg-rose-100 dark:hover:bg-rose-950/40 focus-visible:ring-rose-200",
    issueButtonActive:
      "border-rose-300 dark:border-rose-800 bg-rose-100 dark:bg-rose-950/40 text-rose-950 dark:text-rose-100 ring-rose-200",
    fieldText: "text-rose-700 dark:text-rose-300",
  },
};

export function getErrorToneDefinition(tone: ErrorTone): ErrorToneDefinition {
  return ERROR_TONE_DEFINITIONS[tone];
}

function renderDefaultIcon(tone: ErrorTone, sizeClassName: string) {
  switch (tone) {
    case "info":
      return <Info aria-hidden="true" className={sizeClassName} />;
    case "warning":
      return <TriangleAlert aria-hidden="true" className={sizeClassName} />;
    case "error":
      return <CircleAlert aria-hidden="true" className={sizeClassName} />;
  }
}

interface ErrorToneIconProps {
  tone?: ErrorTone;
  icon?: ReactNode;
  className?: string;
  sizeClassName?: string;
}

export function ErrorToneIcon({
  tone = "error",
  icon,
  className,
  sizeClassName = "h-5 w-5",
}: ErrorToneIconProps) {
  const definition = getErrorToneDefinition(tone);

  return (
    <span
      className={cx(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
        definition.iconShell,
        className,
      )}
    >
      <span className="sr-only">{definition.label}</span>
      {icon ?? renderDefaultIcon(tone, sizeClassName)}
    </span>
  );
}
