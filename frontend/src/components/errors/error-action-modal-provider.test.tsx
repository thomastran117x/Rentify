import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorActionModalProvider,
  useErrorModal,
} from "./error-action-modal-provider";

function ModalHarness({
  onPrimary,
  onRetry,
}: {
  onPrimary: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
}) {
  const { pendingCount, showErrorModal } = useErrorModal();

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          showErrorModal({
            tone: "error",
            title: "First issue",
            message: "The original request failed.",
            actionLabel: "Acknowledge",
            onAction: onPrimary,
            dedupeKey: "first-issue",
          })
        }
      >
        Open first
      </button>
      <button
        type="button"
        onClick={() =>
          showErrorModal({
            tone: "warning",
            title: "Second issue",
            message: "A later retry still needs attention.",
            actionLabel: "Keep going",
            onAction: onPrimary,
            retryLabel: "Retry request",
            onRetry,
          })
        }
      >
        Open second
      </button>
      <button
        type="button"
        onClick={() =>
          showErrorModal({
            tone: "error",
            title: "First issue",
            message: "The original request failed again.",
            actionLabel: "Acknowledge",
            onAction: onPrimary,
            dedupeKey: "first-issue",
          })
        }
      >
        Repeat first
      </button>
      <p>Pending count: {pendingCount}</p>
    </div>
  );
}

function ModalRaceHarness({
  onPrimary,
}: {
  onPrimary: () => void | Promise<void>;
}) {
  const { pendingCount, showErrorModal } = useErrorModal();

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          showErrorModal({
            tone: "error",
            title: "Same issue",
            message: "First copy",
            actionLabel: "Acknowledge",
            onAction: onPrimary,
            dedupeKey: "same-issue",
          });
          showErrorModal({
            tone: "error",
            title: "Same issue",
            message: "Second copy",
            actionLabel: "Acknowledge",
            onAction: onPrimary,
            dedupeKey: "same-issue",
          });
        }}
      >
        Trigger race
      </button>
      <p>Pending count: {pendingCount}</p>
    </div>
  );
}

describe("ErrorActionModalProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the newest issue first and lets the user jump between pending issues", async () => {
    render(
      <ErrorActionModalProvider>
        <ModalHarness onPrimary={vi.fn()} onRetry={vi.fn()} />
      </ErrorActionModalProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open first" }));
    fireEvent.click(screen.getByRole("button", { name: "Open second" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Second issue");
    expect(screen.getByText("Pending count: 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /First issue/ }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent("First issue");
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "The original request failed.",
      );
    });
  });

  it("deduplicates repeated issues by dedupe key and increments the occurrence count", () => {
    render(
      <ErrorActionModalProvider>
        <ModalHarness onPrimary={vi.fn()} onRetry={vi.fn()} />
      </ErrorActionModalProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open first" }));
    fireEvent.click(screen.getByRole("button", { name: "Repeat first" }));

    expect(screen.getByText("Pending count: 1")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("Repeated 2 times");
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "The original request failed again.",
    );
  });

  it("deduplicates back-to-back same-key calls before React flushes state", () => {
    render(
      <ErrorActionModalProvider>
        <ModalRaceHarness onPrimary={vi.fn()} />
      </ErrorActionModalProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger race" }));

    expect(screen.getByText("Pending count: 1")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("Repeated 2 times");
    expect(screen.getByRole("dialog")).toHaveTextContent("Second copy");
  });

  it("fires retry callbacks and dismisses the issue on success", async () => {
    const retrySpy = vi.fn();

    render(
      <ErrorActionModalProvider>
        <ModalHarness onPrimary={vi.fn()} onRetry={retrySpy} />
      </ErrorActionModalProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open second" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry request" }));

    expect(retrySpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Pending count: 0")).toBeInTheDocument();
  });

  it("fires primary actions and dismisses the active issue on success", async () => {
    const primarySpy = vi.fn();

    render(
      <ErrorActionModalProvider>
        <ModalHarness onPrimary={primarySpy} onRetry={vi.fn()} />
      </ErrorActionModalProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open first" }));
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    expect(primarySpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows visible feedback when the primary action fails", async () => {
    const primarySpy = vi.fn().mockRejectedValue(new Error("Network is down."));

    render(
      <ErrorActionModalProvider>
        <ModalHarness onPrimary={primarySpy} onRetry={vi.fn()} />
      </ErrorActionModalProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open first" }));
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent("Action failed");
      expect(screen.getByRole("dialog")).toHaveTextContent("Network is down.");
      expect(screen.getByRole("button", { name: "Acknowledge" })).toBeEnabled();
    });
  });

  it("shows visible feedback when retry fails", async () => {
    const retrySpy = vi
      .fn()
      .mockRejectedValue(
        new Error("Retry request could not reach the server."),
      );

    render(
      <ErrorActionModalProvider>
        <ModalHarness onPrimary={vi.fn()} onRetry={retrySpy} />
      </ErrorActionModalProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open second" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry request" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent("Action failed");
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "Retry request could not reach the server.",
      );
      expect(
        screen.getByRole("button", { name: "Retry request" }),
      ).toBeEnabled();
    });
  });

  it("focuses the modal when opened, ignores overlay clicks, and restores focus after escape", async () => {
    render(
      <ErrorActionModalProvider>
        <ModalHarness onPrimary={vi.fn()} onRetry={vi.fn()} />
      </ErrorActionModalProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Open first" });
    trigger.focus();

    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Acknowledge" })).toHaveFocus();
    });

    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.parentElement!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });
});
