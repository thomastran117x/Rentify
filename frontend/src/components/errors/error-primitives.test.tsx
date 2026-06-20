import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorActionModal,
  type ErrorActionModalIssue,
} from "./error-action-modal";
import { ErrorToast } from "./error-toast";
import { FieldErrorMessage } from "./field-error-message";
import { FormErrorMessage } from "./form-error-message";

describe("error primitives", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing for an empty field message", () => {
    const { container } = render(
      <FieldErrorMessage id="email-error" message={undefined} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders field and form messages with tone-aware content and custom icons", () => {
    render(
      <div>
        <FieldErrorMessage
          id="email-error"
          tone="warning"
          message="Double-check the email address."
          icon={<span data-testid="field-icon">!</span>}
        />
        <FormErrorMessage
          tone="info"
          title="Heads up"
          message="The request is taking longer than usual."
          icon={<span data-testid="form-icon">i</span>}
        />
      </div>,
    );

    const fieldMessage = screen.getByText("Double-check the email address.");
    const formAlert = screen.getByRole("alert");

    expect(fieldMessage.closest("p")).toHaveAttribute("id", "email-error");
    expect(screen.getByTestId("field-icon")).toBeInTheDocument();
    expect(screen.getByTestId("form-icon")).toBeInTheDocument();
    expect(formAlert).toHaveTextContent("Heads up");
    expect(formAlert).toHaveTextContent(
      "The request is taking longer than usual.",
    );
  });

  it("renders toast actions and dismiss controls", async () => {
    const actionSpy = vi.fn();
    const dismissSpy = vi.fn();

    render(
      <ErrorToast
        tone="error"
        title="Upload failed"
        message="The image could not be processed."
        actionLabel="Retry upload"
        onAction={actionSpy}
        onDismiss={dismissSpy}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry upload" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Upload failed");
    expect(actionSpy).toHaveBeenCalledTimes(1);
    expect(dismissSpy).toHaveBeenCalledTimes(1);
  });

  it("renders the action modal, keeps overlay clicks inert, and restores focus after escape", async () => {
    const actionSpy = vi.fn();
    const retrySpy = vi.fn();
    const closeSpy = vi.fn();
    const selectSpy = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "Open issue";
    document.body.appendChild(trigger);
    trigger.focus();

    const issue: ErrorActionModalIssue = {
      id: "issue-2",
      tone: "warning",
      title: "Second issue",
      message: "The latest retry still needs your attention.",
      actionLabel: "Keep going",
      retryLabel: "Retry request",
      occurrenceCount: 2,
    };

    const { rerender } = render(
      <ErrorActionModal
        open
        issue={issue}
        issues={[
          {
            id: "issue-2",
            tone: "warning",
            title: "Second issue",
            message: "The latest retry still needs your attention.",
            actionLabel: "Keep going",
            retryLabel: "Retry request",
            occurrenceCount: 2,
          },
          {
            id: "issue-1",
            tone: "error",
            title: "First issue",
            message: "The original request failed.",
            actionLabel: "Acknowledge",
            occurrenceCount: 1,
          },
        ]}
        onSelectIssue={selectSpy}
        onAction={actionSpy}
        onRetry={retrySpy}
        onClose={closeSpy}
      />,
    );

    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement;

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Retry request" }),
      ).toHaveFocus();
    });

    fireEvent.click(backdrop!);
    expect(closeSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /First issue/ }));
    expect(selectSpy).toHaveBeenCalledWith("issue-1");

    fireEvent.click(screen.getByRole("button", { name: "Retry request" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    expect(retrySpy).toHaveBeenCalledTimes(1);
    expect(actionSpy).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeSpy).toHaveBeenCalledTimes(1);

    rerender(
      <ErrorActionModal
        open={false}
        issue={null}
        issues={[]}
        onSelectIssue={selectSpy}
        onAction={actionSpy}
        onRetry={retrySpy}
        onClose={closeSpy}
      />,
    );

    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });

    trigger.remove();
  });

  it("shows repeated issue details in the pending issue list", () => {
    render(
      <ErrorActionModal
        open
        issue={{
          id: "issue-2",
          tone: "warning",
          title: "Second issue",
          message: "The latest retry still needs your attention.",
          actionLabel: "Keep going",
          occurrenceCount: 2,
        }}
        issues={[
          {
            id: "issue-2",
            tone: "warning",
            title: "Second issue",
            message: "The latest retry still needs your attention.",
            actionLabel: "Keep going",
            occurrenceCount: 2,
          },
          {
            id: "issue-1",
            tone: "error",
            title: "First issue",
            message: "The original request failed.",
            actionLabel: "Acknowledge",
            occurrenceCount: 1,
          },
        ]}
        onSelectIssue={vi.fn()}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Repeated 2 times");
    expect(within(dialog).getByText("Pending issues")).toBeInTheDocument();
  });

  it("restores focus when the modal unmounts while still open", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Return focus";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <ErrorActionModal
        open
        issue={{
          id: "issue-1",
          tone: "error",
          title: "First issue",
          message: "The original request failed.",
          actionLabel: "Acknowledge",
          occurrenceCount: 1,
        }}
        issues={[
          {
            id: "issue-1",
            tone: "error",
            title: "First issue",
            message: "The original request failed.",
            actionLabel: "Acknowledge",
            occurrenceCount: 1,
          },
        ]}
        onSelectIssue={vi.fn()}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    unmount();

    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });

    trigger.remove();
  });
});
