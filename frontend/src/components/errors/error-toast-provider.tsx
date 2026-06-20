"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ErrorToast } from "./error-toast";
import type { ErrorTone } from "./tone";

const DEFAULT_TOAST_DURATION_MS = 5000;

interface ErrorToastRecord {
  id: string;
  tone: ErrorTone;
  title?: ReactNode;
  message: ReactNode;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  durationMs: number;
}

export interface ShowErrorToastOptions {
  tone?: ErrorTone;
  title?: ReactNode;
  message: ReactNode;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  durationMs?: number;
}

interface ErrorToastContextValue {
  showError: (options: ShowErrorToastOptions) => string;
  dismissError: (id: string) => void;
}

const ErrorToastContext = createContext<ErrorToastContextValue | null>(null);

interface ErrorToastProviderProps {
  children: ReactNode;
}

export function ErrorToastProvider({ children }: ErrorToastProviderProps) {
  const [toasts, setToasts] = useState<ErrorToastRecord[]>([]);
  const nextIdRef = useRef(0);
  const timeoutIdsRef = useRef(new Map<string, number>());

  const dismissError = useCallback((id: string) => {
    const timeoutId = timeoutIdsRef.current.get(id);

    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      timeoutIdsRef.current.delete(id);
    }

    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showError = useCallback(
    ({
      tone = "error",
      title,
      message,
      icon,
      actionLabel,
      onAction,
      durationMs = DEFAULT_TOAST_DURATION_MS,
    }: ShowErrorToastOptions) => {
      nextIdRef.current += 1;
      const id = `error-toast-${nextIdRef.current}`;

      setToasts((current) => [
        ...current,
        {
          id,
          tone,
          title,
          message,
          icon,
          actionLabel,
          onAction,
          durationMs,
        },
      ]);

      const timeoutId = window.setTimeout(() => {
        dismissError(id);
      }, durationMs);

      timeoutIdsRef.current.set(id, timeoutId);

      return id;
    },
    [dismissError],
  );

  useEffect(() => {
    const timeoutIds = timeoutIdsRef.current;

    return () => {
      for (const timeoutId of timeoutIds.values()) {
        window.clearTimeout(timeoutId);
      }

      timeoutIds.clear();
    };
  }, []);

  const value = useMemo<ErrorToastContextValue>(
    () => ({
      showError,
      dismissError,
    }),
    [dismissError, showError],
  );

  return (
    <ErrorToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 top-4 z-[70] flex flex-col items-end gap-3 sm:inset-x-auto sm:right-4 sm:w-full sm:max-w-sm">
        {toasts.map((toast) => (
          <ErrorToast
            key={toast.id}
            tone={toast.tone}
            title={toast.title}
            message={toast.message}
            icon={toast.icon}
            actionLabel={toast.actionLabel}
            onAction={() => {
              if (!toast.onAction) {
                return;
              }

              Promise.resolve(toast.onAction())
                .then(() => dismissError(toast.id))
                .catch((error: unknown) => {
                  console.error("Toast action failed.", error);
                });
            }}
            onDismiss={() => dismissError(toast.id)}
          />
        ))}
      </div>
    </ErrorToastContext.Provider>
  );
}

export function useErrorToast(): ErrorToastContextValue {
  const context = useContext(ErrorToastContext);

  if (!context) {
    throw new Error("useErrorToast must be used within an ErrorToastProvider.");
  }

  return context;
}
