import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorToastProvider, useErrorToast } from "./error-toast-provider";

function ToastHarness({
  onAction,
}: {
  onAction: () => void | Promise<void>;
}) {
  const { showError } = useErrorToast();

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          showError({
            tone: "warning",
            title: "Network warning",
            message: "First toast",
            durationMs: 1000,
          })
        }
      >
        Show warning
      </button>
      <button
        type="button"
        onClick={() =>
          showError({
            tone: "info",
            title: "Heads up",
            message: "Second toast",
            durationMs: 2000,
          })
        }
      >
        Show info
      </button>
      <button
        type="button"
        onClick={() =>
          showError({
            tone: "error",
            title: "Action needed",
            message: "Retry the request.",
            actionLabel: "Retry now",
            onAction,
            durationMs: 4000,
          })
        }
      >
        Show action
      </button>
    </div>
  );
}

describe("ErrorToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("queues multiple toasts and auto-dismisses them by duration", () => {
    render(
      <ErrorToastProvider>
        <ToastHarness onAction={vi.fn()} />
      </ErrorToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show warning" }));
    fireEvent.click(screen.getByRole("button", { name: "Show info" }));

    expect(screen.getByText("First toast")).toBeInTheDocument();
    expect(screen.getByText("Second toast")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText("First toast")).not.toBeInTheDocument();
    expect(screen.getByText("Second toast")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText("Second toast")).not.toBeInTheDocument();
  });

  it("allows manual dismissal", () => {
    render(
      <ErrorToastProvider>
        <ToastHarness onAction={vi.fn()} />
      </ErrorToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show warning" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );

    expect(screen.queryByText("First toast")).not.toBeInTheDocument();
  });

  it("fires toast actions and dismisses on success", async () => {
    const actionSpy = vi.fn();

    render(
      <ErrorToastProvider>
        <ToastHarness onAction={actionSpy} />
      </ErrorToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show action" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));

    expect(actionSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText("Retry the request.")).not.toBeInTheDocument();
  });
});
