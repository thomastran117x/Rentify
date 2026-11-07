"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";

interface RecoveryCodesDisplayProps {
  codes: string[];
  onDone: () => void;
}

const DOWNLOAD_FILE_NAME = "rentify-recovery-codes.txt";

function toFileContents(codes: string[]): string {
  return [
    "Rentify recovery codes",
    "",
    "Each code works once, in place of a code from your authenticator app.",
    "Keep them somewhere safe.",
    "",
    ...codes,
    "",
  ].join("\n");
}

function downloadCodes(codes: string[]): void {
  const url = URL.createObjectURL(
    new Blob([toFileContents(codes)], { type: "text/plain" }),
  );
  const link = document.createElement("a");

  link.href = url;
  link.download = DOWNLOAD_FILE_NAME;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The one time a set of recovery codes is visible. They stay in this
 * component's props, so they are gone once the user moves on or leaves.
 */
export function RecoveryCodesDisplay({
  codes,
  onDone,
}: RecoveryCodesDisplayProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  const secondaryButton =
    "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
        <p className="font-semibold">Save your recovery codes now</p>
        <p className="mt-1">
          This is the only time you&apos;ll see them. If you lose your
          authenticator app, each code gets you in once.
        </p>
      </div>

      <ul
        aria-label="Recovery codes"
        className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4 font-mono text-sm tracking-wider text-slate-900 dark:text-white sm:grid-cols-2"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className={secondaryButton}
        >
          {copyStatus === "copied" ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
          {copyStatus === "copied" ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={() => downloadCodes(codes)}
          className={secondaryButton}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download
        </button>
      </div>

      {copyStatus === "failed" ? (
        <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
          We couldn&apos;t copy to your clipboard. Download the codes instead,
          or write them down.
        </p>
      ) : null}

      <button
        type="button"
        onClick={onDone}
        className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
      >
        I&apos;ve saved these codes
      </button>
    </div>
  );
}
