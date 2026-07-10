"use client";

import { useEffect } from "react";

export function OAuthPopupFinish() {
  useEffect(() => {
    if (!window.opener) {
      return;
    }

    const payload = window.location.hash || window.location.search;

    window.opener.postMessage(
      {
        source: "rentify-oauth-popup",
        payload,
      },
      window.location.origin,
    );

    window.close();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900 px-6 text-slate-700 dark:text-slate-200">
      <div className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3 text-sm font-medium shadow-sm">
        Finishing sign-in...
      </div>
    </main>
  );
}
