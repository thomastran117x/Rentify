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
  const [operationError, setOperationError] = useState<string | null>(null);

  const commitState = useCallback(
    (updater: (current: ErrorModalState) => ErrorModalState) => {
      const next = updater(stateRef.current);
      stateRef.current = next;
      setState(next);
      return next;
    },
    [],
  );

  useEffect(() => {
    setOperationError(null);
  }, [state.activeId]);

  const dismissErrorModal = useCallback(
    (id: string) => {
      commitState((current) => {
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
      setOperationError(null);
    },
    [commitState],
  );

  const selectErrorModal = useCallback(
    (id: string) => {
      commitState((current) => {
        if (!current.issues.some((issue) => issue.id === id)) {
          return current;
        }

        return {
          ...current,
          activeId: id,
        };
      });
      setOperationError(null);
    },
    [commitState],
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

        commitState((current) => ({
          activeId: updatedIssue.id,
          issues: [
            updatedIssue,
            ...current.issues.filter((issue) => issue.id !== updatedIssue.id),
          ],
        }));
        setOperationError(null);

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

      commitState((current) => ({
        activeId: id,
        issues: [issue, ...current.issues],
      }));
      setOperationError(null);

      return id;
    },
    [commitState],
  );

  const activeIssue = useMemo(
    () =>
      state.issues.find((issue) => issue.id === state.activeId) ??
      state.issues[0] ??
      null,
    [state.activeId, state.issues],
  );

  const getHandlerFailureMessage = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof Error) {
        const trimmedMessage = error.message.trim();

        if (trimmedMessage.length > 0) {
          return trimmedMessage;
        }
      }

      return fallback;
    },
    [],
  );

  const runIssueHandler = useCallback(
    async (kind: "action" | "retry") => {
      const currentIssue = activeIssue;

      if (!currentIssue) {
        return;
      }

      const handler = kind === "action" ? currentIssue.onAction : currentIssue.onRetry;

      if (!handler) {
        return;
      }

      const fallbackMessage =
        kind === "action"
          ? "We couldn't complete that action. Please try again."
          : "We couldn't retry that action. Please try again.";

      try {
        setOperationError(null);
        setBusyAction(kind);
        await Promise.resolve(handler());
        dismissErrorModal(currentIssue.id);
      } catch (error) {
        console.error(
          kind === "action" ? "Modal action failed." : "Modal retry failed.",
          error,
        );
        setOperationError(getHandlerFailureMessage(error, fallbackMessage));
      } finally {
        setBusyAction(null);
      }
    },
    [activeIssue, dismissErrorModal, getHandlerFailureMessage],
  );

  const handleIssueAction = useCallback(async () => {
    if (!activeIssue) {
      return;
    }

    await runIssueHandler("action");
  }, [activeIssue, runIssueHandler]);

  const handleIssueRetry = useCallback(async () => {
    if (!activeIssue?.onRetry) {
      return;
    }

    await runIssueHandler("retry");
  }, [activeIssue, runIssueHandler]);

  const handleClose = useCallback(() => {
    if (activeIssue) {
      dismissErrorModal(activeIssue.id);
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
        onClose={handleClose}
        busyAction={busyAction}
        operationError={operationError}
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
