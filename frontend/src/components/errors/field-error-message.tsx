import type { ReactNode } from "react";
import { ErrorToneIcon, getErrorToneDefinition, type ErrorTone } from "./tone";
import { cx } from "./utils";

interface FieldErrorMessageProps {
  id: string;
  message?: ReactNode;
  tone?: ErrorTone;
  icon?: ReactNode;
  className?: string;
}

export function FieldErrorMessage({
  id,
  message,
  tone = "error",
  icon,
  className,
}: FieldErrorMessageProps) {
  if (!message) {
    return null;
  }

  const definition = getErrorToneDefinition(tone);

  return (
    <p
      id={id}
      className={cx(
        "inline-flex items-start gap-2 text-sm leading-6",
        definition.fieldText,
        className,
      )}
    >
      <ErrorToneIcon
        tone={tone}
        icon={icon}
        className="mt-0.5 h-5 w-5 rounded-full border-0 bg-transparent p-0"
        sizeClassName="h-4 w-4"
      />
      <span>{message}</span>
    </p>
  );
}
