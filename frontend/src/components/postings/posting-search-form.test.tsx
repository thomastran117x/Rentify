import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toDateTimeLocalValue } from "@/lib/postings/search-form";
import { PostingSearchForm } from "./posting-search-form";

describe("PostingSearchForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates datetime-local inputs from initial values", () => {
    render(
      <PostingSearchForm
        initialStartAt="2026-06-15T09:30:00.000Z"
        initialEndAt="2026-06-17T18:45:00.000Z"
      >
        <input type="datetime-local" name="startAt" aria-label="Start date" />
        <input type="datetime-local" name="endAt" aria-label="End date" />
      </PostingSearchForm>,
    );

    expect(screen.getByLabelText("Start date")).toHaveValue(
      toDateTimeLocalValue("2026-06-15T09:30:00.000Z"),
    );
    expect(screen.getByLabelText("End date")).toHaveValue(
      toDateTimeLocalValue("2026-06-17T18:45:00.000Z"),
    );
  });

  it("redirects with normalized query params on submit", async () => {
    const user = userEvent.setup();
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        pathname: "/postings",
        assign: assignSpy,
      },
    });

    render(
      <PostingSearchForm initialStartAt="2026-06-15T09:30:00.000Z">
        <input name="q" aria-label="Query" defaultValue="  loft  " />
        <input name="tags" defaultValue="wifi" />
        <input type="datetime-local" name="startAt" aria-label="Start date" />
        <button type="submit">Search</button>
      </PostingSearchForm>,
    );

    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(assignSpy).toHaveBeenCalledWith(
      `/postings?q=loft&tags=wifi&startAt=${encodeURIComponent(
        new Date(toDateTimeLocalValue("2026-06-15T09:30:00.000Z")).toISOString(),
      )}`,
    );
  });
});
