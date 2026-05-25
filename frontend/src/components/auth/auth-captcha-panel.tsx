"use client";

import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { publicEnv } from "@/lib/env";
import { theme } from "@/styles/theme";

interface AuthCaptchaPanelProps {
  token: string;
  error?: string;
  onChange: (token: string) => void;
  onReset: () => void;
}

export function AuthCaptchaPanel({
  token,
  error,
  onChange,
  onReset,
}: AuthCaptchaPanelProps) {
  return (
    <div className={theme.auth.captchaPanel}>
      <TurnstileWidget value={token} onChange={onChange} />

      {publicEnv.turnstileSiteKey && token ? (
        <div
          className={`mt-3 flex flex-wrap items-center justify-between gap-3 ${theme.auth.successPanel}`}
        >
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition duration-200 hover:border-violet-200 hover:bg-violet-50"
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
