"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { publicEnv } from "@/lib/env";

const LOCAL_CAPTCHA_BYPASS_TOKEN = "local-dev-bypass";
const TURNSTILE_RESET_BACKOFF_MS = [1000, 3000, 10000] as const;

function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase();
  return (
    normalizedHostname === "localhost" || normalizedHostname === "127.0.0.1"
  );
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: (error?: string | number) => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove?: (widgetId: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  value: string;
  onChange: (value: string) => void;
}

export function TurnstileWidget({ value, onChange }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const previousValueRef = useRef(value);
  const resetTimeoutRef = useRef<number | null>(null);
  const resetAttemptRef = useRef(0);
  const onChangeRef = useRef(onChange);

  const [scriptLoaded, setScriptLoaded] = useState(
    () => typeof window !== "undefined" && Boolean(window.turnstile),
  );
  const [hasError, setHasError] = useState(false);
  const canUseLoopbackBypass =
    typeof window !== "undefined" &&
    isLoopbackHostname(window.location.hostname);
  const shouldUseLocalBypass =
    !publicEnv.turnstileSiteKey || (hasError && canUseLoopbackBypass);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const emitChange = useCallback((nextValue: string) => {
    onChangeRef.current(nextValue);
  }, []);

  const clearScheduledReset = useCallback(() => {
    if (resetTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(resetTimeoutRef.current);
    resetTimeoutRef.current = null;
  }, []);

  const clearResetRecovery = useCallback(() => {
    clearScheduledReset();
    resetAttemptRef.current = 0;
  }, [clearScheduledReset]);

  const handleTurnstileLoadFailure = useCallback(() => {
    clearResetRecovery();
    setHasError(true);
    emitChange(canUseLoopbackBypass ? LOCAL_CAPTCHA_BYPASS_TOKEN : "");
  }, [canUseLoopbackBypass, clearResetRecovery, emitChange]);

  const scheduleResetWithBackoff = useCallback(() => {
    if (resetTimeoutRef.current !== null) {
      return;
    }

    if (!widgetIdRef.current || !window.turnstile) {
      handleTurnstileLoadFailure();
      return;
    }

    if (resetAttemptRef.current >= TURNSTILE_RESET_BACKOFF_MS.length) {
      handleTurnstileLoadFailure();
      return;
    }

    const delay = TURNSTILE_RESET_BACKOFF_MS[resetAttemptRef.current];
    resetAttemptRef.current += 1;

    resetTimeoutRef.current = window.setTimeout(() => {
      resetTimeoutRef.current = null;

      if (!widgetIdRef.current || !window.turnstile) {
        handleTurnstileLoadFailure();
        return;
      }

      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        handleTurnstileLoadFailure();
      }
    }, delay);
  }, [handleTurnstileLoadFailure]);

  const disposeWidget = useCallback(() => {
    clearScheduledReset();

    if (!widgetIdRef.current || !window.turnstile?.remove) {
      widgetIdRef.current = null;
      return;
    }

    try {
      window.turnstile.remove(widgetIdRef.current);
    } catch {
      // Ignore widget cleanup races after the fallback path takes over.
    } finally {
      widgetIdRef.current = null;
    }
  }, [clearScheduledReset]);

  useEffect(() => {
    if (!shouldUseLocalBypass) {
      return;
    }

    if (!value) {
      emitChange(LOCAL_CAPTCHA_BYPASS_TOKEN);
    }
  }, [emitChange, shouldUseLocalBypass, value]);

  useEffect(() => {
    if (!publicEnv.turnstileSiteKey) return;
    if (!scriptLoaded) return;
    if (!window.turnstile) return;
    if (!containerRef.current) return;
    if (widgetIdRef.current) return;

    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: publicEnv.turnstileSiteKey,
        theme: "light",
        size: "flexible",
        callback: (token: string) => {
          clearResetRecovery();
          setHasError(false);
          emitChange(token);
        },
        "expired-callback": () => {
          emitChange("");
        },
        "error-callback": () => {
          scheduleResetWithBackoff();
        },
      });
    } catch (err) {
      console.error("Turnstile render failed", err);
      queueMicrotask(() => {
        handleTurnstileLoadFailure();
      });
    }

    return () => {
      clearResetRecovery();
      disposeWidget();
    };
  }, [
    clearResetRecovery,
    disposeWidget,
    emitChange,
    handleTurnstileLoadFailure,
    scheduleResetWithBackoff,
    scriptLoaded,
  ]);

  useEffect(() => {
    const previousValue = previousValueRef.current;
    previousValueRef.current = value;

    if (value) {
      clearResetRecovery();
      return;
    }

    if (
      hasError ||
      !previousValue ||
      !widgetIdRef.current ||
      !window.turnstile
    ) {
      return;
    }

    scheduleResetWithBackoff();
  }, [clearResetRecovery, hasError, scheduleResetWithBackoff, value]);

  if (shouldUseLocalBypass) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
        {!publicEnv.turnstileSiteKey
          ? "Captcha is disabled for this environment. Local auth requests will use the development verification bypass."
          : "Cloudflare Turnstile could not be loaded on this local environment. Continuing with the development verification bypass."}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Script
        id="cloudflare-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
        onError={handleTurnstileLoadFailure}
      />

      <div className="w-full max-w-[420px]">
        <div ref={containerRef} />
      </div>

      {hasError && (
        <p className="text-sm text-rose-700">
          Cloudflare Turnstile could not be loaded. Refresh the page and try
          again.
        </p>
      )}
    </div>
  );
}
