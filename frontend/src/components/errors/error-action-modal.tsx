"use client";

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { FormErrorMessage } from "./form-error-message";
import {
  ErrorToneIcon,
  getErrorToneDefinition,
  type ErrorTone,
} from "./tone";
import { cx } from "./utils";

export interface ErrorActionModalIssue {
  id: string;
  tone: ErrorTone;
  title: ReactNode;
  message: ReactNode;
  actionLabel: string;
  retryLabel?: string;
  icon?: ReactNode;
  occurrenceCount: number;
}

interface ErrorActionModalProps {
  open: boolean;
  issue: ErrorActionModalIssue | null;
  issues: ErrorActionModalIssue[];
  onSelectIssue: (id: string) => void;
  onAction: () => void;
  onRetry?: () => void;
  onClose: () => void;
  busyAction?: "action" | "retry" | null;
  operationError?: string | null;
}

function getFocusableElements(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}

export function ErrorActionModal({
  open,
  issue,
  issues,
  onSelectIssue,
  onAction,
  onRetry,
  onClose,
  busyAction = null,
  operationError = null,
}: ErrorActionModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const restoreFocus = useCallback(() => {
    if (!restoreFocusRef.current) {
      return;
    }

    try {
      restoreFocusRef.current.focus();
    } catch {
      // Ignore focus restoration if the original element no longer exists.
    } finally {
      restoreFocusRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open || !dialogRef.current) {
      if (!open) {
        restoreFocus();
      }

      return;
    }

    if (!restoreFocusRef.current && document.activeElement instanceof HTMLElement) {
      restoreFocusRef.current = document.activeElement;
    }

    const [firstFocusableElement] = getFocusableElements(dialogRef.current);
    (firstFocusableElement ?? dialogRef.current).focus();
  }, [issue?.id, open, restoreFocus]);

  useEffect(() => restoreFocus, [restoreFocus]);

  useEffect(() => {
    if (!open || !dialogRef.current) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!dialogRef.current) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements(dialogRef.current);

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const firstFocusableElement = focusableElements[0]!;
      const lastFocusableElement = focusableElements[focusableElements.length - 1]!;
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === firstFocusableElement) {
        event.preventDefault();
        lastFocusableElement.focus();
      } else if (!event.shiftKey && activeElement === lastFocusableElement) {
        event.preventDefault();
        firstFocusableElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || !issue) {
    return null;
  }

  const definition = getErrorToneDefinition(issue.tone);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 px-4 py-8">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cx(
          "w-full max-w-4xl rounded-[2rem] border bg-white p-6 shadow-[0_30px_100px_rgba(15,23,42,0.28)] outline-none sm:p-7",
          definition.panel,
        )}
      >
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start gap-3">
              <ErrorToneIcon tone={issue.tone} icon={issue.icon} />
              <div className="min-w-0 flex-1">
                <p className={cx("text-xs font-semibold uppercase tracking-[0.18em]", definition.iconText)}>
                  {definition.label} requiring attention
                </p>
                <h2
                  id={titleId}
                  className={cx(
                    "mt-2 text-2xl font-semibold tracking-[-0.04em]",
                    definition.panelText,
                  )}
                >
                  {issue.title}
                </h2>
                <p id={descriptionId} className={cx("mt-3 text-sm leading-7", definition.mutedText)}>
                  {issue.message}
                </p>
                {issue.occurrenceCount > 1 ? (
                  <p className={cx("mt-3 text-xs font-medium uppercase tracking-[0.14em]", definition.iconText)}>
                    Repeated {issue.occurrenceCount} times
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              {operationError ? (
                <div className="w-full">
                  <FormErrorMessage
                    title="Action failed"
                    message={operationError}
                  />
                </div>
              ) : null}
              {issue.retryLabel && onRetry ? (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={onRetry}
                  className={cx(
                    "inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60",
                    definition.secondaryButton,
                  )}
                >
                  {issue.retryLabel}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={onAction}
                className={cx(
                  "inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60",
                  definition.primaryButton,
                )}
              >
                {issue.actionLabel}
              </button>
            </div>
          </div>

          {issues.length > 1 ? (
            <aside className="w-full rounded-[1.5rem] border border-white/80 bg-white/50 p-4 lg:max-w-xs">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">
                    Pending issues
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                    {issues.length} total
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {issues.map((pendingIssue) => {
                  const pendingDefinition = getErrorToneDefinition(pendingIssue.tone);
                  const isActive = pendingIssue.id === issue.id;

                  return (
                    <button
                      key={pendingIssue.id}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => onSelectIssue(pendingIssue.id)}
                      className={cx(
                        "rounded-[1.15rem] border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2",
                        pendingDefinition.issueButton,
                        isActive && cx("ring-2", pendingDefinition.issueButtonActive),
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <ErrorToneIcon
                          tone={pendingIssue.tone}
                          icon={pendingIssue.icon}
                          className="h-8 w-8 rounded-xl"
                          sizeClassName="h-4 w-4"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-semibold text-slate-950">
                            {pendingIssue.title}
                          </p>
                          {pendingIssue.occurrenceCount > 1 ? (
                            <p className="mt-1 text-xs text-slate-500">
                              Repeated {pendingIssue.occurrenceCount} times
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
