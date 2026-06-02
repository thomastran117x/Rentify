"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { publicEnv } from "@/lib/env";

const LOCAL_CAPTCHA_BYPASS_TOKEN = "local-dev-bypass";

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

  const [scriptLoaded, setScriptLoaded] = useState(
    () => typeof window !== "undefined" && Boolean(window.turnstile),
  );
  const [hasError, setHasError] = useState(false);
  const canUseLoopbackBypass =
    typeof window !== "undefined" &&
    isLoopbackHostname(window.location.hostname);
  const shouldUseLocalBypass =
    !publicEnv.turnstileSiteKey || (hasError && canUseLoopbackBypass);

  function handleTurnstileLoadFailure() {
    setHasError(true);
    onChange(canUseLoopbackBypass ? LOCAL_CAPTCHA_BYPASS_TOKEN : "");
  }

  function disposeWidget() {
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
  }

  useEffect(() => {
    if (!shouldUseLocalBypass) {
      return;
    }

    if (!value) {
      onChange(LOCAL_CAPTCHA_BYPASS_TOKEN);
    }
  }, [onChange, shouldUseLocalBypass, value]);

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
          setHasError(false);
          onChange(token);
        },
        "expired-callback": () => {
          onChange("");
        },
        "error-callback": () => {
          handleTurnstileLoadFailure();
        },
      });
    } catch (err) {
      console.error("Turnstile render failed", err);
      queueMicrotask(() => {
        handleTurnstileLoadFailure();
      });
    }

    return () => {
      disposeWidget();
    };
  }, [scriptLoaded, onChange]);

  useEffect(() => {
    if (hasError || value || !widgetIdRef.current || !window.turnstile) {
      return;
    }

    try {
      window.turnstile.reset(widgetIdRef.current);
    } catch {
      disposeWidget();
    }
  }, [hasError, value]);

  if (shouldUseLocalBypass) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
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
