"use client";

import {
  RECOVERY_CODES_LOW_THRESHOLD,
  type MfaRecoveryCodeStatusResult,
} from "@/lib/auth/mfa-recovery-codes-api";

interface HomeMfaRecoveryCodesSectionProps {
  status: MfaRecoveryCodeStatusResult;
  pending: boolean;
  onRegenerate: () => void;
}

const NOTICE_TONES = {
  neutral: "border-slate-200 dark:border-slate-800",
  warning:
    "border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40",
  danger:
    "border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40",
};

function describeStatus({ remaining, createdAt }: MfaRecoveryCodeStatusResult) {
  if (!createdAt) {
    return {
      tone: "warning" as const,
      title: "No recovery codes yet",
      detail:
        "Without them, losing your authenticator app could lock you out of your account.",
      action: "Generate recovery codes",
    };
  }

  if (remaining === 0) {
    return {
      tone: "danger" as const,
      title: "You've used all your recovery codes",
      detail:
        "Generate new ones now, or losing your authenticator app could lock you out of your account.",
      action: "Generate new codes",
    };
  }

  const count = `${remaining} recovery ${remaining === 1 ? "code" : "codes"} left`;

  if (remaining <= RECOVERY_CODES_LOW_THRESHOLD) {
    return {
      tone: "warning" as const,
      title: `Only ${count}`,
      detail:
        "Generate a new set before you run out. It replaces every code you have now.",
      action: "Generate new codes",
    };
  }

  return {
    tone: "neutral" as const,
    title: count,
    detail:
      "Each one signs you in once if you lose your authenticator app. A new set replaces every code you have now.",
    action: "Generate new codes",
  };
}

export function HomeMfaRecoveryCodesSection({
  status,
  pending,
  onRegenerate,
}: HomeMfaRecoveryCodesSectionProps) {
  const { tone, title, detail, action } = describeStatus(status);

  return (
    <div
      role={tone === "neutral" ? undefined : "status"}
      className={`mt-3 flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${NOTICE_TONES[tone]}`}
    >
      <div>
        <p className="text-sm font-medium text-slate-950 dark:text-white">
          {title}
        </p>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
          {detail}
        </p>
      </div>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={pending}
        className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Working..." : action}
      </button>
    </div>
  );
}
