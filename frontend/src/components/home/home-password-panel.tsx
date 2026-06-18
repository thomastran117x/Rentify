"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { authApi } from "@/lib/auth/api";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { ApiClientError } from "@/lib/auth/types";

interface PasswordErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

function validatePasswordChange(values: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): PasswordErrors {
  const errors: PasswordErrors = {};

  if (!values.currentPassword) {
    errors.currentPassword = "Current password is required.";
  }

  if (!values.newPassword) {
    errors.newPassword = "New password is required.";
  } else if (values.newPassword.length < 8) {
    errors.newPassword = "Password must be at least 8 characters.";
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Please confirm your new password.";
  } else if (values.newPassword !== values.confirmPassword) {
    errors.confirmPassword = "Passwords do not match.";
  }

  return errors;
}

export function HomePasswordPanel() {
  const { status, setSession } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validatePasswordChange({
      currentPassword,
      newPassword,
      confirmPassword,
    });
    setErrors(nextErrors);
    setMessage(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setPending(true);

    try {
      const session = await authApi.changePassword({
        currentPassword,
        newPassword,
      });

      setSession(session);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setErrors({});
      setMessage("Password updated. Other sessions were signed out.");
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.status === 401) {
          setErrors((current) => ({
            ...current,
            currentPassword: "Current password is incorrect.",
          }));
          return;
        }

        if (error.status === 409) {
          setMessage(
            getApiErrorMessage(error, {
              action: "update your password",
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
          action: "update your password",
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

  return (
    <section className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.35)]">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
          Password
        </p>
        <h2 className="text-3xl font-semibold tracking-[-0.03em] text-slate-950">
          Change password
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          Keep this device signed in while we revoke your other active sessions.
        </p>
      </div>

      <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
        {message ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {message}
          </div>
        ) : null}

        <div className="space-y-2">
          <label
            htmlFor="currentPassword"
            className="text-sm font-medium text-slate-700"
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
            className={`h-14 w-full rounded-2xl border bg-white px-4 text-[15px] text-slate-900 outline-none transition ${
              errors.currentPassword
                ? "border-rose-300 ring-4 ring-rose-100"
                : currentPasswordHasValue
                  ? "border-indigo-300 ring-4 ring-indigo-50"
                  : "border-slate-200 hover:border-indigo-200"
            }`}
          />
          {errors.currentPassword ? (
            <p className="text-sm text-rose-700">{errors.currentPassword}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="newPassword"
            className="text-sm font-medium text-slate-700"
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
            className={`h-14 w-full rounded-2xl border bg-white px-4 text-[15px] text-slate-900 outline-none transition ${
              errors.newPassword
                ? "border-rose-300 ring-4 ring-rose-100"
                : newPasswordHasValue
                  ? "border-sky-300 ring-4 ring-sky-50"
                  : "border-slate-200 hover:border-sky-200"
            }`}
          />
          {errors.newPassword ? (
            <p className="text-sm text-rose-700">{errors.newPassword}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="confirmPassword"
            className="text-sm font-medium text-slate-700"
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
            className={`h-14 w-full rounded-2xl border bg-white px-4 text-[15px] text-slate-900 outline-none transition ${
              errors.confirmPassword
                ? "border-rose-300 ring-4 ring-rose-100"
                : confirmPasswordHasValue
                  ? "border-indigo-300 ring-4 ring-indigo-50"
                  : "border-slate-200 hover:border-indigo-200"
            }`}
          />
          {errors.confirmPassword ? (
            <p className="text-sm text-rose-700">{errors.confirmPassword}</p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-14 w-full cursor-pointer items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition duration-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {pending ? "Updating password..." : "Update password"}
        </button>
      </form>
    </section>
  );
}
