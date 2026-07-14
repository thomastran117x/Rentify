"use client";

import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { publicEnv } from "@/lib/env";
import { theme } from "@/styles/theme";

interface AuthCaptchaPanelProps {
  token: string;
  error?: string;
  onChange: (token: string) => void;
  onReset: () => void;
  stale?: boolean;
  staleMessage?: string;
}

export function AuthCaptchaPanel({
  token,
  error,
  onChange,
  onReset,
  stale = false,
  staleMessage,
}: AuthCaptchaPanelProps) {
  return (
    <div className={theme.auth.captchaPanel}>
      <TurnstileWidget value={token} onChange={onChange} />

      {publicEnv.turnstileSiteKey && token ? (
        <div
          className={`mt-3 flex flex-wrap items-center justify-between gap-3 ${theme.auth.successPanel}`}
        >
          {stale && staleMessage ? (
            <p className="text-sm text-slate-700 dark:text-slate-200">
              {staleMessage}
            </p>
          ) : null}

          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 text-sm font-semibold text-slate-900 dark:text-white transition duration-200 hover:border-violet-200 dark:hover:border-violet-800 hover:bg-violet-50 dark:hover:bg-violet-950/40"
          >
            Run again
          </button>
        </div>
      ) : null}

      {error ? (
        <p className={`mt-2 ${theme.auth.fieldErrorText}`}>{error}</p>
      ) : null}
    </div>
  );
}
