"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FieldErrorMessage, FormErrorMessage } from "@/components/errors";
import { isApiClientError } from "@/lib/api/types";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { describeUser, validationMessage } from "@/lib/admin-security/format";
import type {
  AccountStatusAction,
  AuthAuditUserSummary,
} from "@/lib/admin-security/types";
import { trapTabKey } from "./focusable";

export const ACCOUNT_STATUS_REASON_MIN_LENGTH = 5;
export const ACCOUNT_STATUS_REASON_MAX_LENGTH = 255;

const ACTION_COPY: Record<
  AccountStatusAction,
  {
    title: string;
    description: string;
    confirm: string;
    pending: string;
    destructive: boolean;
  }
> = {
  lock: {
    title: "Put on a security hold",
    description:
      "Ends every session and personal access token. The user can recover the account by resetting their password.",
    confirm: "Place security hold",
    pending: "Placing hold...",
    destructive: true,
  },
  suspend: {
    title: "Suspend account",
    description:
      "Ends every session and personal access token. Only an admin can reinstate the account.",
    confirm: "Suspend account",
    pending: "Suspending...",
    destructive: true,
  },
  reinstate: {
    title: "Reinstate account",
    description:
      "The account becomes active again. The user has to sign in again; ended sessions do not come back.",
    confirm: "Reinstate account",
    pending: "Reinstating...",
    destructive: false,
  },
};

interface AdminAccountStatusDialogProps {
  action: AccountStatusAction;
  user: AuthAuditUserSummary;
  /** Rejects with the API error when the change fails. */
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * Asks for the reason behind a lock, suspension or reinstatement. It sits on
 * top of the account drawer with its own focus trap and Escape handling; the
 * drawer ignores keys while it is open, so closing it leaves the drawer open.
 */
export function AdminAccountStatusDialog({
  action,
  user,
  onConfirm,
  onCancel,
}: AdminAccountStatusDialogProps) {
  const copy = ACTION_COPY[action];
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const reasonId = useId();
  const reasonHintId = useId();
  const reasonErrorId = useId();

  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    textareaRef.current?.focus();

    return () => opener?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const dialog = dialogRef.current;

      if (!dialog) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();

        if (!submitting) {
          onCancel();
        }
        return;
      }

      trapTabKey(event, dialog);
    },
    [onCancel, submitting],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();

    if (trimmed.length < ACCOUNT_STATUS_REASON_MIN_LENGTH) {
      setFieldError(
        `Give a reason of at least ${ACCOUNT_STATUS_REASON_MIN_LENGTH} characters.`,
      );
      textareaRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      await onConfirm(trimmed);
    } catch (error) {
      setSubmitting(false);

      if (isApiClientError(error) && error.status === 400) {
        setFieldError(validationMessage(error));
        return;
      }

      // A 409 (lock after suspend) and a 403 (own account) carry a message
      // written for the admin, so show it as is.
      if (
        isApiClientError(error) &&
        (error.status === 409 || error.status === 403)
      ) {
        setSubmitError(error.message);
        return;
      }

      setSubmitError(
        getApiErrorMessage(error, {
          action: "change this account's status",
          fallback:
            "We couldn't change this account's status. Please try again.",
        }),
      );
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8">
      <div
        aria-hidden
        onClick={submitting ? undefined : onCancel}
        className="absolute inset-0 bg-slate-950/45"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">
          {describeUser(user)}
        </p>
        <h2
          id={titleId}
          className="mt-1 text-xl font-semibold text-slate-950 dark:text-white"
        >
          {copy.title}
        </h2>
        <p
          id={descriptionId}
          className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300"
        >
          {copy.description}
        </p>

        <form className="mt-5 grid gap-4" onSubmit={handleSubmit} noValidate>
          <div className="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
            <label htmlFor={reasonId} className="font-medium">
              Reason
            </label>
            <textarea
              id={reasonId}
              ref={textareaRef}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setFieldError(null);
                setSubmitError(null);
              }}
              rows={4}
              maxLength={ACCOUNT_STATUS_REASON_MAX_LENGTH}
              disabled={submitting}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={
                fieldError ? `${reasonErrorId} ${reasonHintId}` : reasonHintId
              }
              className="rounded-xl border border-slate-300 px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-950 disabled:opacity-60 dark:border-slate-700 dark:text-white dark:focus:border-slate-400"
              placeholder="What happened, and what should the next admin know?"
            />
            <p
              id={reasonHintId}
              className="flex justify-between gap-3 text-xs text-slate-500 dark:text-slate-400"
            >
              <span>
                Kept on the account and in the audit log. The user never sees
                it.
              </span>
              <span aria-hidden>
                {reason.length}/{ACCOUNT_STATUS_REASON_MAX_LENGTH}
              </span>
            </p>
            <FieldErrorMessage id={reasonErrorId} message={fieldError} />
          </div>

          {submitError ? (
            <FormErrorMessage
              title="Couldn't change the status"
              message={submitError}
            />
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                copy.destructive
                  ? "bg-rose-600 hover:bg-rose-700"
                  : "bg-slate-950 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
              }`}
            >
              {submitting ? copy.pending : copy.confirm}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
