import type { ReactNode } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";

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
    panel: "border-sky-200 bg-sky-50 text-sky-950",
    panelText: "text-sky-950",
    mutedText: "text-sky-900/80",
    iconShell: "border border-sky-200 bg-white text-sky-700",
    iconText: "text-sky-700",
    primaryButton:
      "bg-sky-700 text-white hover:bg-sky-800 focus-visible:ring-sky-200",
    secondaryButton:
      "border border-sky-200 bg-white text-sky-950 hover:bg-sky-100 focus-visible:ring-sky-200",
    issueButton:
      "border-sky-200 bg-white/85 text-sky-950 hover:bg-sky-100 focus-visible:ring-sky-200",
    issueButtonActive: "border-sky-300 bg-sky-100 text-sky-950 ring-sky-200",
    fieldText: "text-sky-800",
  },
  warning: {
    label: "Warning",
    panel: "border-amber-200 bg-amber-50 text-amber-950",
    panelText: "text-amber-950",
    mutedText: "text-amber-900/80",
    iconShell: "border border-amber-200 bg-white text-amber-700",
    iconText: "text-amber-700",
    primaryButton:
      "bg-amber-400 text-slate-950 hover:bg-amber-500 focus-visible:ring-amber-200",
    secondaryButton:
      "border border-amber-200 bg-white text-amber-950 hover:bg-amber-100 focus-visible:ring-amber-200",
    issueButton:
      "border-amber-200 bg-white/85 text-amber-950 hover:bg-amber-100 focus-visible:ring-amber-200",
    issueButtonActive:
      "border-amber-300 bg-amber-100 text-amber-950 ring-amber-200",
    fieldText: "text-amber-900",
  },
  error: {
    label: "Error",
    panel: "border-rose-200 bg-rose-50 text-rose-950",
    panelText: "text-rose-950",
    mutedText: "text-rose-900/80",
    iconShell: "border border-rose-200 bg-white text-rose-700",
    iconText: "text-rose-700",
    primaryButton:
      "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-200",
    secondaryButton:
      "border border-rose-200 bg-white text-rose-950 hover:bg-rose-100 focus-visible:ring-rose-200",
    issueButton:
      "border-rose-200 bg-white/85 text-rose-950 hover:bg-rose-100 focus-visible:ring-rose-200",
    issueButtonActive:
      "border-rose-300 bg-rose-100 text-rose-950 ring-rose-200",
    fieldText: "text-rose-700",
  },
};

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

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
