import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostingAutocompleteInput } from "./posting-autocomplete-input";

const { fetchPublicPostingAutocompleteMock } = vi.hoisted(() => ({
  fetchPublicPostingAutocompleteMock: vi.fn(),
}));

vi.mock("@/lib/postings/search", () => ({
  fetchPublicPostingAutocomplete: fetchPublicPostingAutocompleteMock,
}));

describe("PostingAutocompleteInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPublicPostingAutocompleteMock.mockResolvedValue({
      query: "lo",
      suggestions: [],
      source: "database",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not fetch suggestions below the minimum query length", async () => {
    render(
      <PostingAutocompleteInput
        label="Search postings"
        placeholder="Search"
        shellClassName="block"
        inputClassName="input"
        onSubmitQuery={vi.fn()}
      />,
    );

    const input = screen.getByRole("combobox", { name: "Search postings" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "a" } });
    await new Promise((resolve) => window.setTimeout(resolve, 300));

    expect(fetchPublicPostingAutocompleteMock).not.toHaveBeenCalled();
  });

  it("loads suggestions after the debounce and submits a clicked suggestion", async () => {
    const onSubmitQuery = vi.fn();
    fetchPublicPostingAutocompleteMock.mockResolvedValue({
      query: "lo",
      suggestions: [
        { value: "Loft retreat", kind: "name" },
        { value: "London", kind: "location" },
      ],
      source: "database",
    });

    render(
      <PostingAutocompleteInput
        label="Search postings"
        placeholder="Search"
        shellClassName="block"
        inputClassName="input"
        onSubmitQuery={onSubmitQuery}
      />,
    );

    const input = screen.getByRole("combobox", { name: "Search postings" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "lo" } });
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Loft retreat" }),
      ).toBeInTheDocument();
    });

    expect(fetchPublicPostingAutocompleteMock).toHaveBeenCalledWith(
      {
        q: "lo",
        family: undefined,
        subtype: undefined,
        limit: 6,
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Loft retreat" }));

    expect(onSubmitQuery).toHaveBeenCalledWith("Loft retreat");
  });

  it("supports keyboard navigation to submit the highlighted suggestion", async () => {
    const onSubmitQuery = vi.fn();
    fetchPublicPostingAutocompleteMock.mockResolvedValue({
      query: "ca",
      suggestions: [
        { value: "Cabin stay", kind: "name" },
        { value: "Cape Cod", kind: "location" },
      ],
      source: "database",
    });

    render(
      <PostingAutocompleteInput
        label="Search postings"
        placeholder="Search"
        shellClassName="block"
        inputClassName="input"
        onSubmitQuery={onSubmitQuery}
      />,
    );

    const input = screen.getByRole("combobox", { name: "Search postings" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ca" } });
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Cabin stay" }),
      ).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSubmitQuery).toHaveBeenCalledWith("Cabin stay");
  });

  it("submits the current query through the parent form when there is no dropdown selection", async () => {
    const requestSubmitSpy = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    render(
      <form>
        <PostingAutocompleteInput
          label="Search postings"
          placeholder="Search"
          shellClassName="block"
          inputClassName="input"
        />
      </form>,
    );

    const input = screen.getByRole("combobox", { name: "Search postings" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "  loft  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(requestSubmitSpy).toHaveBeenCalled();
    });
    expect(input).toHaveValue("loft");
  });
});
