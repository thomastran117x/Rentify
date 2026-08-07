import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SavePostingButton } from "./save-posting-button";

const { useSavedPostingsMock, toggleSavedMock } = vi.hoisted(() => ({
  useSavedPostingsMock: vi.fn(),
  toggleSavedMock: vi.fn(),
}));

vi.mock("@/components/postings/saved-postings-context", () => ({
  useSavedPostings: useSavedPostingsMock,
}));

function mockContext(options: { saved?: boolean; pending?: boolean } = {}) {
  useSavedPostingsMock.mockReturnValue({
    status: "ready",
    truncated: false,
    isSaved: () => options.saved ?? false,
    isPending: () => options.pending ?? false,
    toggleSaved: toggleSavedMock,
    refresh: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  });
}

describe("SavePostingButton", () => {
  beforeEach(() => {
    toggleSavedMock.mockReset();
    toggleSavedMock.mockResolvedValue(undefined);
  });

  it("renders an outline heart and a save label when unsaved", () => {
    mockContext({ saved: false });

    render(
      <SavePostingButton postingId="posting-1" postingName="Sunny loft" />,
    );

    const button = screen.getByRole("button", { name: "Save Sunny loft" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button.querySelector("svg")).toHaveAttribute("fill", "none");
  });

  it("renders a filled heart and a remove label when saved", () => {
    mockContext({ saved: true });

    render(
      <SavePostingButton postingId="posting-1" postingName="Sunny loft" />,
    );

    const button = screen.getByRole("button", {
      name: "Remove Sunny loft from saved postings",
    });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button.querySelector("svg")).toHaveAttribute("fill", "currentColor");
  });

  it("toggles the posting when clicked", async () => {
    mockContext({ saved: false });
    const user = userEvent.setup();

    render(
      <SavePostingButton postingId="posting-1" postingName="Sunny loft" />,
    );
    await user.click(screen.getByRole("button", { name: "Save Sunny loft" }));

    expect(toggleSavedMock).toHaveBeenCalledWith("posting-1");
  });

  it("disables the control while the toggle is in flight", async () => {
    mockContext({ saved: false, pending: true });
    const user = userEvent.setup();

    render(
      <SavePostingButton postingId="posting-1" postingName="Sunny loft" />,
    );
    const button = screen.getByRole("button", { name: "Save Sunny loft" });

    expect(button).toBeDisabled();
    await user.click(button);
    expect(toggleSavedMock).not.toHaveBeenCalled();
  });

  it("shows a text label in the labelled variant", () => {
    mockContext({ saved: true });

    render(
      <SavePostingButton
        postingId="posting-1"
        postingName="Sunny loft"
        variant="labelled"
      />,
    );

    expect(screen.getByText("Saved")).toBeInTheDocument();
  });
});
