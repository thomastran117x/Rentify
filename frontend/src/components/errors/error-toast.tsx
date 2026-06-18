"use client";

import type { ReactNode } from "react";
import { ErrorToneIcon, getErrorToneDefinition, type ErrorTone } from "./tone";
import { cx } from "./utils";

export interface ErrorToastProps {
  tone?: ErrorTone;
  title?: ReactNode;
  message: ReactNode;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

export function ErrorToast({
  tone = "error",
  title,
  message,
  icon,
  actionLabel,
  onAction,
  onDismiss,
}: ErrorToastProps) {
  const definition = getErrorToneDefinition(tone);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cx(
        "pointer-events-auto w-full max-w-sm rounded-[1.75rem] border px-4 py-4 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.45)] backdrop-blur-sm",
        definition.panel,
      )}
    >
      <div className="flex items-start gap-3">
        <ErrorToneIcon tone={tone} icon={icon} />
        <div className="min-w-0 flex-1">
          {title ? (
            <p
              className={cx(
                "font-semibold tracking-[-0.01em]",
                definition.panelText,
              )}
            >
              {title}
            </p>
          ) : null}
          <p
            className={cx(
              "text-sm leading-6",
              title ? "mt-1" : undefined,
              definition.mutedText,
            )}
          >
            {message}
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={onDismiss}
          className={cx(
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-white/70 text-lg font-medium transition hover:bg-white focus-visible:outline-none focus-visible:ring-2",
            definition.iconText,
          )}
        >
          <span aria-hidden="true">x</span>
        </button>
      </div>

      {actionLabel && onAction ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onAction}
            className={cx(
              "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2",
              definition.secondaryButton,
            )}
          >
            {actionLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
