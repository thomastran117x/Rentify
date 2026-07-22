"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { HelpCircle, KeyRound, UserRound, X } from "lucide-react";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { ForgotUsernameForm } from "@/components/auth/forgot-username-form";
import { clearPersistedAuthPendingFlowByType } from "@/lib/auth/pending-flow";

type RecoveryView = "options" | "username" | "password";

interface AccountRecoveryDialogProps {
  initialView?: RecoveryView;
  open: boolean;
  onClose: () => void;
}

interface AccountRecoveryDialogContentProps {
  dialogRef: RefObject<HTMLDivElement | null>;
  descriptionId: string;
  initialView: RecoveryView;
  onClose: () => void;
  titleId: string;
}

function getFocusableElements(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

function AccountRecoveryDialogContent({
  dialogRef,
  descriptionId,
  initialView,
  onClose,
  titleId,
}: AccountRecoveryDialogContentProps) {
  const [view, setView] = useState<RecoveryView>(initialView);

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
        ? "Enter your email and we'll send the username on file, including auto-generated usernames for social sign-in accounts."
        : "Use your username to request a reset code and choose a new password.";

  function clearPasswordRecoveryIfNeeded() {
    if (view === "password") {
      clearPersistedAuthPendingFlowByType("forgot-password-reset");
    }
  }

  function handleClose() {
    clearPasswordRecoveryIfNeeded();
    onClose();
  }

  function handleBackToOptions() {
    clearPersistedAuthPendingFlowByType("forgot-password-reset");
    setView("options");
  }

  return (
    <div className="fixed inset-0 z-[95] overflow-y-auto bg-slate-950/60 px-3 pb-4 pt-[4.75rem] sm:flex sm:items-start sm:justify-center sm:px-4 sm:pb-8 sm:pt-[5rem]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="mx-auto w-full max-w-[34rem] overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.28)] outline-none max-h-[calc(100dvh-5.5rem)] dark:border-slate-800 dark:bg-slate-900 sm:max-h-[calc(100dvh-4rem)]"
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
            onClick={handleClose}
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
                  Get your username emailed to you, including the one generated
                  for a Google or Microsoft sign-in.
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
                  Request a reset code with your username and sign back in with
                  a new password.
                </p>
              </div>
            </button>
          </div>
        ) : null}

        {view === "username" ? (
          <div className="mt-6 space-y-5">
            <button
              type="button"
              onClick={() => setView("options")}
              className="text-sm font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Back to recovery options
            </button>
            <ForgotUsernameForm />
          </div>
        ) : null}

        {view === "password" ? (
          <div className="mt-6 space-y-5">
            <button
              type="button"
              onClick={handleBackToOptions}
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

export function AccountRecoveryDialog({
  initialView = "options",
  open,
  onClose,
}: AccountRecoveryDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
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
  }, [open]);

  useEffect(() => {
    if (!open || !dialogRef.current) {
      return;
    }

    const [firstFocusable] = getFocusableElements(dialogRef.current);
    (firstFocusable ?? dialogRef.current).focus();
  }, [open]);

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

  return (
    <AccountRecoveryDialogContent
      dialogRef={dialogRef}
      descriptionId={descriptionId}
      initialView={initialView}
      onClose={onClose}
      titleId={titleId}
    />
  );
}
