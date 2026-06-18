import type { ReactNode } from "react";
import { ErrorToneIcon, getErrorToneDefinition, type ErrorTone } from "./tone";
import { cx } from "./utils";

interface FormErrorMessageProps {
  title?: ReactNode;
  message?: ReactNode;
  tone?: ErrorTone;
  icon?: ReactNode;
  className?: string;
}

export function FormErrorMessage({
  title,
  message,
  tone = "error",
  icon,
  className,
}: FormErrorMessageProps) {
  if (!message) {
    return null;
  }

  const definition = getErrorToneDefinition(tone);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cx(
        "flex items-start gap-3 rounded-[1.5rem] border px-4 py-3 text-sm shadow-sm",
        definition.panel,
        className,
      )}
    >
      <ErrorToneIcon tone={tone} icon={icon} />
      <div className="min-w-0">
        {title ? (
          <p className={cx("font-semibold tracking-[-0.01em]", definition.panelText)}>
            {title}
          </p>
        ) : null}
        <p className={cx(title ? "mt-1" : undefined, "leading-6", definition.mutedText)}>
          {message}
        </p>
      </div>
    </div>
  );
}
