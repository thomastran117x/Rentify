"use client";

import { useEffect, useId, useRef, useState } from "react";
import { HelpCircle, KeyRound, UserRound, X } from "lucide-react";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

interface AccountRecoveryDialogProps {
  open: boolean;
  onClose: () => void;
}

type RecoveryView = "options" | "username" | "password";

function getFocusableElements(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

export function AccountRecoveryDialog({
  open,
  onClose,
}: AccountRecoveryDialogProps) {
  const [view, setView] = useState<RecoveryView>("options");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
      setView("options");
      if (restoreFocusRef.current) {
        restoreFocusRef.current.focus();
        restoreFocusRef.current = null;
      }
      return;
    }

    if (
      !restoreFocusRef.current &&
      document.activeElement instanceof HTMLElement
    ) {
      restoreFocusRef.current = document.activeElement;
    }

    setView("options");
  }, [open]);

  useEffect(() => {
    if (!open || !dialogRef.current) {
      return;
    }

    const [firstFocusable] = getFocusableElements(dialogRef.current);
    (firstFocusable ?? dialogRef.current).focus();
  }, [open, view]);

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

      const first = focusableElements[0]!;
      const last = focusableElements[focusableElements.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const title =
    view === "options"
      ? "I can't log in"
      : view === "username"
        ? "Forgot username"
        : "Reset password";
  const description =
    view === "options"
      ? "Choose the account help you need and we'll guide you through the next step."
      : view === "username"
        ? "Username recovery is coming next."
        : "Use your email to request a reset code and choose a new password.";

  return (
    <div className="fixed inset-0 z-[95] overflow-y-auto bg-slate-950/60 px-4 py-4 sm:flex sm:items-center sm:justify-center sm:py-8">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="mx-auto w-full max-w-[34rem] overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.28)] outline-none max-h-[calc(100dvh-2rem)] dark:border-slate-800 dark:bg-slate-900 sm:max-h-[calc(100dvh-4rem)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {view === "username" ? (
              <UserRound className="h-6 w-6" aria-hidden="true" />
            ) : view === "password" ? (
              <KeyRound className="h-6 w-6" aria-hidden="true" />
            ) : (
              <HelpCircle className="h-6 w-6" aria-hidden="true" />
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Close account recovery dialog"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <h2
          id={titleId}
          className="mt-4 text-xl font-semibold text-slate-950 dark:text-white"
        >
          {title}
        </h2>
        <p
          id={descriptionId}
          className="mt-1.5 text-sm leading-6 text-slate-500 dark:text-slate-400"
        >
          {description}
        </p>

        {view === "options" ? (
          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => setView("username")}
              className="flex w-full items-start gap-3 rounded-[1.5rem] border border-slate-200 px-4 py-4 text-left transition hover:border-amber-300 hover:bg-amber-50/60 dark:border-slate-800 dark:hover:border-amber-800 dark:hover:bg-amber-950/20"
            >
              <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <UserRound className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-950 dark:text-white">
                  I forgot my username
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  Start an email-based username recovery flow once it ships.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setView("password")}
              className="flex w-full items-start gap-3 rounded-[1.5rem] border border-amber-200 bg-amber-50/70 px-4 py-4 text-left transition hover:border-amber-300 hover:bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 dark:hover:border-amber-800"
            >
              <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-950 dark:text-white">
                  I forgot my password
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  Request a reset code and sign back in with a new password.
                </p>
              </div>
            </button>
          </div>
        ) : null}

        {view === "username" ? (
          <div className="mt-6 space-y-5">
            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
              Forgot username is still a placeholder in this branch. We&apos;ll add
              the email-based username recovery workflow next.
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setView("options")}
                className="inline-flex h-12 flex-1 items-center justify-center rounded-2xl border border-slate-200 px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Back
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-12 flex-1 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
              >
                Back to sign in
              </button>
            </div>
          </div>
        ) : null}

        {view === "password" ? (
          <div className="mt-6 space-y-5">
            <button
              type="button"
              onClick={() => setView("options")}
              className="text-sm font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Back to recovery options
            </button>
            <ForgotPasswordForm />
          </div>
        ) : null}
      </div>
    </div>
  );
}
