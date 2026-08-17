"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { PartyPopper, UserRound, X } from "lucide-react";
import { FieldErrorMessage, FormErrorMessage } from "@/components/errors";
import { UsernameAvailabilityHint } from "@/components/auth/username-availability-hint";
import { profilesApi } from "@/lib/profiles/api";
import { normalizeUsername, validateUsernameFormat } from "@/lib/auth/username";
import { useUsernameAvailability } from "@/lib/auth/use-username-availability";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { theme } from "@/styles/theme";

interface OAuthWelcomeModalProps {
  open: boolean;
  /** The auto-generated username assigned when the account was created. */
  username: string;
  /** Called after the username is successfully changed, with the new value. */
  onUsernameSaved: (username: string) => void;
  /** Called when the user dismisses the modal (via save-and-continue, keep, or close). */
  onClose: () => void;
}

interface OAuthWelcomeModalContentProps {
  dialogRef: RefObject<HTMLDivElement | null>;
  descriptionId: string;
  titleId: string;
  username: string;
  onUsernameSaved: (username: string) => void;
  onClose: () => void;
}

function getFocusableElements(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

function OAuthWelcomeModalContent({
  dialogRef,
  descriptionId,
  titleId,
  username,
  onUsernameSaved,
  onClose,
}: OAuthWelcomeModalContentProps) {
  const [value, setValue] = useState(username);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const trimmed = normalizeUsername(value);
  const isUnchanged = useMemo(
    () => trimmed === normalizeUsername(username),
    [trimmed, username],
  );
  const availability = useUsernameAvailability(value, {
    currentUsername: username,
  });

  async function handleSave() {
    const nextError =
      validateUsernameFormat(value) ??
      (availability.status === "taken"
        ? "That username is already taken."
        : undefined);
    setFieldError(nextError);
    setGeneralError(null);

    if (nextError) {
      return;
    }

    // Nothing to save — treat "Save" on an unchanged username as "keep".
    if (isUnchanged) {
      onClose();
      return;
    }

    setPending(true);

    try {
      // Sends only the username. PUT /profile/me is a partial update, so the
      // omitted phone and avatar fields are left as they are.
      const result = await profilesApi.updateMine({ username: trimmed });
      onUsernameSaved(result.username);
      onClose();
    } catch (error) {
      setGeneralError(
        getApiErrorMessage(error, {
          action: "update your username",
          preserveClientMessage: true,
          fallback:
            "We couldn't update your username right now. You can change it later under Account.",
        }),
      );
    } finally {
      setPending(false);
    }
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
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <PartyPopper className="h-6 w-6" aria-hidden="true" />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Close welcome dialog"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <h2
          id={titleId}
          className="mt-4 text-xl font-semibold text-slate-950 dark:text-white"
        >
          Welcome to Rentify
        </h2>
        <p
          id={descriptionId}
          className="mt-1.5 text-sm leading-6 text-slate-500 dark:text-slate-400"
        >
          Your account was created from your social sign-in. We picked a
          username to get you started &mdash; keep it or change it below.
        </p>

        <div className="mt-6 space-y-5">
          {generalError ? (
            <FormErrorMessage
              title="Couldn't update your username"
              message={generalError}
            />
          ) : null}

          <div className="space-y-2">
            <label
              htmlFor="oauth-welcome-username"
              className={theme.auth.fieldLabel}
            >
              Your username
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400 dark:text-slate-500">
                <UserRound className="h-5 w-5" aria-hidden="true" />
              </span>
              <input
                id="oauth-welcome-username"
                name="username"
                type="text"
                autoComplete="username"
                aria-invalid={Boolean(fieldError)}
                aria-describedby={
                  fieldError
                    ? "oauth-welcome-username-error"
                    : "oauth-welcome-username-hint"
                }
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setFieldError(undefined);
                }}
                className={`h-14 w-full rounded-2xl border bg-white dark:bg-slate-900 pl-12 pr-4 text-[15px] text-slate-900 dark:text-white outline-none transition duration-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 ${
                  fieldError ? theme.auth.fieldError : theme.auth.fieldActive
                }`}
              />
            </div>
            {fieldError ? (
              <FieldErrorMessage
                id="oauth-welcome-username-error"
                message={fieldError}
              />
            ) : availability.status !== "idle" ? (
              <UsernameAvailabilityHint
                id="oauth-welcome-username-hint"
                availability={availability}
              />
            ) : (
              <p
                id="oauth-welcome-username-hint"
                className={theme.auth.fieldText}
              >
                You&apos;ll use this username to sign in and to recover your
                account. Find it any time under Account &rarr; Profile.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={pending}
              className={theme.auth.primaryButton}
            >
              {pending
                ? "Saving..."
                : isUnchanged
                  ? "Looks good"
                  : "Save username"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className={theme.auth.secondaryButton}
            >
              Keep this username
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OAuthWelcomeModal({
  open,
  username,
  onUsernameSaved,
  onClose,
}: OAuthWelcomeModalProps) {
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
    <OAuthWelcomeModalContent
      dialogRef={dialogRef}
      descriptionId={descriptionId}
      titleId={titleId}
      username={username}
      onUsernameSaved={onUsernameSaved}
      onClose={onClose}
    />
  );
}
