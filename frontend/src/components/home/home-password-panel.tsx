"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { MfaVerificationDialog } from "@/components/auth/mfa-verification-dialog";
import { authApi } from "@/lib/auth/api";
import { isApiClientError } from "@/lib/api/types";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { ApiClientError } from "@/lib/auth/types";
import { STRONG_PASSWORD_MESSAGE, isStrongPassword } from "@/lib/auth/password";
import {
  type MfaVerificationOptionsResult,
  type MfaVerificationScope,
  mfaVerificationApi,
} from "@/lib/auth/mfa-verification-api";

interface PasswordErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

/**
 * `set` is the OAuth-only case: the account has no password yet, so there is no
 * current one to re-enter. The `mfa-management` step-up the Security tab already
 * required stands in as proof of identity.
 */
type Mode = "change" | "set";

const MFA_SCOPE: MfaVerificationScope = "mfa-management";

function validatePasswordChange(
  values: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  },
  mode: Mode,
): PasswordErrors {
  const errors: PasswordErrors = {};

  if (mode === "change" && !values.currentPassword) {
    errors.currentPassword = "Current password is required.";
  }

  if (!values.newPassword) {
    errors.newPassword = "New password is required.";
  } else if (!isStrongPassword(values.newPassword)) {
    errors.newPassword = STRONG_PASSWORD_MESSAGE;
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Please confirm your new password.";
  } else if (values.newPassword !== values.confirmPassword) {
    errors.confirmPassword = "Passwords do not match.";
  }

  return errors;
}

interface HomePasswordPanelProps {
  /**
   * Whether the account already has a local password. Omit to let the panel
   * resolve it itself from `GET /auth/oauth/providers`.
   */
  hasPassword?: boolean;
  /** Called after a first password is set, so the caller can refresh its copy. */
  onPasswordSet?: () => void;
}

export function HomePasswordPanel({
  hasPassword,
  onPasswordSet,
}: HomePasswordPanelProps) {
  const { status, setSession, session } = useAuth();
  const [resolvedHasPassword, setResolvedHasPassword] = useState<
    boolean | null
  >(hasPassword ?? null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogOptions, setDialogOptions] =
    useState<MfaVerificationOptionsResult | null>(null);
  const verificationResolverRef = useRef<((value: boolean) => void) | null>(
    null,
  );

  useEffect(() => {
    if (hasPassword !== undefined) {
      setResolvedHasPassword(hasPassword);
    }
  }, [hasPassword]);

  // Only when the caller did not tell us -- keeps the component usable at mount
  // points that do not already hold the linked-providers result.
  useEffect(() => {
    if (hasPassword !== undefined || status !== "authenticated") {
      return;
    }

    let active = true;

    authApi
      .linkedOAuthProviders()
      .then((result) => {
        if (active) setResolvedHasPassword(result.hasPassword);
      })
      .catch(() => {
        // Fall back to the change form: it is the safe default, and a genuinely
        // password-less account still gets a clear conflict message on submit.
        if (active) setResolvedHasPassword(true);
      });

    return () => {
      active = false;
    };
  }, [hasPassword, status]);

  function closeDialogWith(result: boolean) {
    setDialogOptions(null);
    verificationResolverRef.current?.(result);
    verificationResolverRef.current = null;
  }

  /**
   * The Security tab verifies identity before rendering this panel, but that
   * proof expires after 15 minutes. Re-prompt rather than reporting the 401 as a
   * wrong current password.
   */
  async function ensureMfaProof(
    initialOptions?: MfaVerificationOptionsResult,
  ): Promise<boolean> {
    try {
      const options =
        initialOptions ?? (await mfaVerificationApi.getOptions(MFA_SCOPE));

      if (options.verified) {
        return true;
      }

      if (options.availableFactors.length === 0) {
        setMessage(
          "We couldn't verify your identity because no verification methods are available for this account. Please contact support.",
        );
        return false;
      }

      return await new Promise<boolean>((resolve) => {
        verificationResolverRef.current = resolve;
        setDialogOptions(options);
      });
    } catch (error) {
      setMessage(
        getApiErrorMessage(error, {
          action: "verify your identity",
          fallback:
            "We couldn't verify your identity right now. Please try again.",
          preserveClientMessage: true,
        }),
      );
      return false;
    }
  }

  const mode: Mode = resolvedHasPassword === false ? "set" : "change";

  async function submitPassword() {
    return mode === "set"
      ? authApi.setPassword({ newPassword })
      : authApi.changePassword({ currentPassword, newPassword });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validatePasswordChange(
      { currentPassword, newPassword, confirmPassword },
      mode,
    );
    setErrors(nextErrors);
    setMessage(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setPending(true);

    try {
      const result = await submitPassword().catch(async (error: unknown) => {
        if (
          !isApiClientError(error) ||
          error.code !== "MFA_VERIFICATION_REQUIRED"
        ) {
          throw error;
        }

        const details = error.details as
          | Pick<
              MfaVerificationOptionsResult,
              | "scope"
              | "availableFactors"
              | "recommendedFactor"
              | "verifiedUntil"
            >
          | undefined;
        const verified = await ensureMfaProof(
          details ? { ...details, verified: false } : undefined,
        );

        return verified ? submitPassword() : null;
      });

      if (!result) {
        return;
      }

      setSession(result);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setErrors({});

      if (mode === "set") {
        setResolvedHasPassword(true);
        setMessage(
          `Password set. You can now sign in with your username (${result.user.username}) and password, or keep using your connected provider. Other sessions were signed out.`,
        );
        onPasswordSet?.();
      } else {
        setMessage("Password updated. Other sessions were signed out.");
      }
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.status === 401 && mode === "change") {
          setErrors((current) => ({
            ...current,
            currentPassword: "Current password is incorrect.",
          }));
          return;
        }

        if (error.status === 409) {
          setMessage(
            getApiErrorMessage(error, {
              action:
                mode === "set" ? "set your password" : "update your password",
              fallback:
                "We couldn't update your password right now. Please try again.",
              preserveClientMessage: true,
            }),
          );
          return;
        }
      }

      setMessage(
        getApiErrorMessage(error, {
          action: mode === "set" ? "set your password" : "update your password",
          fallback:
            "We couldn't update your password right now. Please try again.",
        }),
      );
    } finally {
      setPending(false);
    }
  }

  const currentPasswordHasValue = useMemo(
    () => currentPassword.length > 0,
    [currentPassword],
  );
  const newPasswordHasValue = useMemo(
    () => newPassword.length > 0,
    [newPassword],
  );
  const confirmPasswordHasValue = useMemo(
    () => confirmPassword.length > 0,
    [confirmPassword],
  );

  if (status !== "authenticated") {
    return null;
  }

  if (resolvedHasPassword === null) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Loading password settings...
      </p>
    );
  }

  return (
    <>
      <form className="space-y-5" onSubmit={handleSubmit}>
        {mode === "set" ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            You signed up with a social provider, so there is no current
            password to confirm. Setting one lets you sign in with your username
            {session?.user.username ? ` (${session.user.username})` : ""} as
            well.
          </p>
        ) : null}

        {message ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
            {message}
          </div>
        ) : null}

        {mode === "change" ? (
          <div className="space-y-2">
            <label
              htmlFor="currentPassword"
              className="text-sm font-medium text-slate-700 dark:text-slate-200"
            >
              Current password
            </label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={`h-14 w-full rounded-2xl border bg-white dark:bg-slate-900 px-4 text-[15px] text-slate-900 dark:text-white outline-none transition ${
                errors.currentPassword
                  ? "border-rose-300 dark:border-rose-800 ring-4 ring-rose-100"
                  : currentPasswordHasValue
                    ? "border-indigo-300 dark:border-indigo-800 ring-4 ring-indigo-50"
                    : "border-slate-200 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800"
              }`}
            />
            {errors.currentPassword ? (
              <p className="text-sm text-rose-700 dark:text-rose-300">
                {errors.currentPassword}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-2">
          <label
            htmlFor="newPassword"
            className="text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            New password
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className={`h-14 w-full rounded-2xl border bg-white dark:bg-slate-900 px-4 text-[15px] text-slate-900 dark:text-white outline-none transition ${
              errors.newPassword
                ? "border-rose-300 dark:border-rose-800 ring-4 ring-rose-100"
                : newPasswordHasValue
                  ? "border-sky-300 dark:border-sky-800 ring-4 ring-sky-50"
                  : "border-slate-200 dark:border-slate-800 hover:border-sky-200"
            }`}
          />
          {errors.newPassword ? (
            <p className="text-sm text-rose-700 dark:text-rose-300">
              {errors.newPassword}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="confirmPassword"
            className="text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={`h-14 w-full rounded-2xl border bg-white dark:bg-slate-900 px-4 text-[15px] text-slate-900 dark:text-white outline-none transition ${
              errors.confirmPassword
                ? "border-rose-300 dark:border-rose-800 ring-4 ring-rose-100"
                : confirmPasswordHasValue
                  ? "border-indigo-300 dark:border-indigo-800 ring-4 ring-indigo-50"
                  : "border-slate-200 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800"
            }`}
          />
          {errors.confirmPassword ? (
            <p className="text-sm text-rose-700 dark:text-rose-300">
              {errors.confirmPassword}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-14 w-full cursor-pointer items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition duration-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 dark:disabled:bg-slate-700"
        >
          {pending
            ? mode === "set"
              ? "Setting password..."
              : "Updating password..."
            : mode === "set"
              ? "Set password"
              : "Update password"}
        </button>
      </form>

      {dialogOptions ? (
        <MfaVerificationDialog
          open
          initialOptions={dialogOptions}
          scope={MFA_SCOPE}
          onCancel={() => closeDialogWith(false)}
          onVerified={() => closeDialogWith(true)}
        />
      ) : null}
    </>
  );
}
