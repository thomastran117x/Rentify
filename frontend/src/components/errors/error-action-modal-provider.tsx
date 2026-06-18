"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ErrorActionModal,
  type ErrorActionModalIssue,
} from "./error-action-modal";
import type { ErrorTone } from "./tone";

interface ErrorModalRecord extends ErrorActionModalIssue {
  dedupeKey?: string;
  onAction: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  createdAt: number;
  updatedAt: number;
}

interface ErrorModalState {
  activeId: string | null;
  issues: ErrorModalRecord[];
}

export interface ShowErrorModalOptions {
  tone?: ErrorTone;
  title: ReactNode;
  message: ReactNode;
  actionLabel: string;
  onAction: () => void | Promise<void>;
  retryLabel?: string;
  onRetry?: () => void | Promise<void>;
  icon?: ReactNode;
  dedupeKey?: string;
}

interface ErrorActionModalContextValue {
  showErrorModal: (options: ShowErrorModalOptions) => string;
  dismissErrorModal: (id: string) => void;
  selectErrorModal: (id: string) => void;
  activeModalId: string | null;
  pendingCount: number;
}

const ErrorActionModalContext =
  createContext<ErrorActionModalContextValue | null>(null);

interface ErrorActionModalProviderProps {
  children: ReactNode;
}

export function ErrorActionModalProvider({
  children,
}: ErrorActionModalProviderProps) {
  const [state, setState] = useState<ErrorModalState>({
    activeId: null,
    issues: [],
  });
  const stateRef = useRef(state);
  const nextIdRef = useRef(0);
  const [busyAction, setBusyAction] = useState<"action" | "retry" | null>(null);

  const updateState = useCallback(
    (updater: (current: ErrorModalState) => ErrorModalState) => {
      setState((current) => {
        const next = updater(current);
        stateRef.current = next;
        return next;
      });
    },
    [],
  );

  const dismissErrorModal = useCallback(
    (id: string) => {
      updateState((current) => {
        const remainingIssues = current.issues.filter((issue) => issue.id !== id);
        const nextActiveId =
          current.activeId === id
            ? (remainingIssues[0]?.id ?? null)
            : remainingIssues.some((issue) => issue.id === current.activeId)
              ? current.activeId
              : (remainingIssues[0]?.id ?? null);

        return {
          activeId: nextActiveId,
          issues: remainingIssues,
        };
      });
    },
    [updateState],
  );

  const selectErrorModal = useCallback(
    (id: string) => {
      updateState((current) => {
        if (!current.issues.some((issue) => issue.id === id)) {
          return current;
        }

        return {
          ...current,
          activeId: id,
        };
      });
    },
    [updateState],
  );

  const showErrorModal = useCallback(
    ({
      tone = "error",
      title,
      message,
      actionLabel,
      onAction,
      retryLabel,
      onRetry,
      icon,
      dedupeKey,
    }: ShowErrorModalOptions) => {
      const now = Date.now();
      const existingIssue =
        dedupeKey !== undefined
          ? stateRef.current.issues.find((issue) => issue.dedupeKey === dedupeKey)
          : undefined;

      if (existingIssue) {
        const updatedIssue: ErrorModalRecord = {
          ...existingIssue,
          tone,
          title,
          message,
          actionLabel,
          onAction,
          retryLabel,
          onRetry,
          icon,
          occurrenceCount: existingIssue.occurrenceCount + 1,
          updatedAt: now,
        };

        updateState((current) => ({
          activeId: updatedIssue.id,
          issues: [
            updatedIssue,
            ...current.issues.filter((issue) => issue.id !== updatedIssue.id),
          ],
        }));

        return updatedIssue.id;
      }

      nextIdRef.current += 1;
      const id = `error-modal-${nextIdRef.current}`;
      const issue: ErrorModalRecord = {
        id,
        tone,
        title,
        message,
        actionLabel,
        onAction,
        retryLabel,
        onRetry,
        icon,
        dedupeKey,
        occurrenceCount: 1,
        createdAt: now,
        updatedAt: now,
      };

      updateState((current) => ({
        activeId: id,
        issues: [issue, ...current.issues],
      }));

      return id;
    },
    [updateState],
  );

  const activeIssue =
    state.issues.find((issue) => issue.id === state.activeId) ?? state.issues[0] ?? null;

  const handleIssueAction = useCallback(async () => {
    if (!activeIssue) {
      return;
    }

    try {
      setBusyAction("action");
      await Promise.resolve(activeIssue.onAction());
      dismissErrorModal(activeIssue.id);
    } catch (error) {
      console.error("Modal action failed.", error);
    } finally {
      setBusyAction(null);
    }
  }, [activeIssue, dismissErrorModal]);

  const handleIssueRetry = useCallback(async () => {
    if (!activeIssue?.onRetry) {
      return;
    }

    try {
      setBusyAction("retry");
      await Promise.resolve(activeIssue.onRetry());
      dismissErrorModal(activeIssue.id);
    } catch (error) {
      console.error("Modal retry failed.", error);
    } finally {
      setBusyAction(null);
    }
  }, [activeIssue, dismissErrorModal]);

  const value = useMemo<ErrorActionModalContextValue>(
    () => ({
      showErrorModal,
      dismissErrorModal,
      selectErrorModal,
      activeModalId: state.activeId,
      pendingCount: state.issues.length,
    }),
    [
      dismissErrorModal,
      selectErrorModal,
      showErrorModal,
      state.activeId,
      state.issues.length,
    ],
  );

  return (
    <ErrorActionModalContext.Provider value={value}>
      {children}
      <ErrorActionModal
        open={state.issues.length > 0}
        issue={activeIssue}
        issues={state.issues}
        onSelectIssue={selectErrorModal}
        onAction={handleIssueAction}
        onRetry={activeIssue?.retryLabel && activeIssue.onRetry ? handleIssueRetry : undefined}
        onClose={() => {
          if (activeIssue) {
            dismissErrorModal(activeIssue.id);
          }
        }}
        busyAction={busyAction}
      />
    </ErrorActionModalContext.Provider>
  );
}

export function useErrorModal(): ErrorActionModalContextValue {
  const context = useContext(ErrorActionModalContext);

  if (!context) {
    throw new Error(
      "useErrorModal must be used within an ErrorActionModalProvider.",
    );
  }

  return context;
}
