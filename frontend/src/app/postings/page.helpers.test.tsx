import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ActiveFilters,
  Field,
  FilterChip,
  FilterPanel,
  describeOrganizationFilter,
  isPostingSort,
  parseOptionalNumber,
  readArrayParam,
  readPositiveNumber,
  readSingleParam,
  resolveErrorDetails,
} from "./page";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("postings page helpers", () => {
  it("reads scalar, array, list, and number parameters", () => {
    expect(readSingleParam()).toBeUndefined();
    expect(readSingleParam("one")).toBe("one");
    expect(readSingleParam(["one", "two"])).toBe("one");
    expect(readArrayParam()).toEqual([]);
    expect(readArrayParam(" one, ,two ")).toEqual(["one", "two"]);
    expect(readArrayParam(["one,two", " three "])).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(readPositiveNumber(undefined, 20)).toBe(20);
    expect(readPositiveNumber("1.5", 20)).toBe(20);
    expect(readPositiveNumber("0", 20)).toBe(20);
    expect(readPositiveNumber("3", 20)).toBe(3);
    expect(parseOptionalNumber(undefined)).toBeUndefined();
    expect(parseOptionalNumber("")).toBeUndefined();
    expect(parseOptionalNumber("bad")).toBeUndefined();
    expect(parseOptionalNumber("0")).toBe(0);
    expect(isPostingSort("newest")).toBe(true);
    expect(isPostingSort("unknown")).toBe(false);
    expect(isPostingSort(undefined)).toBe(false);
  });

  it("categorizes every search error shape and fallback", () => {
    expect(
      resolveErrorDetails("", {
        requestUrl: "/postings",
        params: {},
        causeMessage: "FETCH FAILED due to DNS",
      }),
    ).toMatchObject({ title: "Search is temporarily unavailable" });
    expect(
      resolveErrorDetails("", {
        requestUrl: "/postings",
        params: {},
        status: 400,
      }),
    ).toMatchObject({ title: "Invalid search request" });
    expect(
      resolveErrorDetails("", {
        requestUrl: "/postings",
        params: {},
        status: 500,
      }),
    ).toMatchObject({ title: "Search is temporarily unavailable" });
    expect(
      resolveErrorDetails("Forbidden", {
        requestUrl: "/postings",
        params: {},
        status: 403,
      }),
    ).toMatchObject({ description: "Forbidden" });
    expect(
      resolveErrorDetails("", {
        requestUrl: "/postings",
        params: {},
        status: 403,
      }),
    ).toMatchObject({ description: "Please review your filters and try again." });
    expect(resolveErrorDetails("Offline", null)).toMatchObject({
      description: "Offline",
    });
    expect(resolveErrorDetails("", null)).toMatchObject({
      description: "Please try again in a moment.",
    });
  });

  it("describes organization matches, identifiers, query, and no filter", () => {
    expect(
      describeOrganizationFilter("studio", {
        query: "studio",
        truncated: false,
        matches: [{ id: "org-1", name: "Studio Co", slug: "studio-co" }],
      }),
    ).toBe("Organization: Studio Co");
    expect(
      describeOrganizationFilter(undefined, {
        organizationId: "org-1",
        truncated: false,
        matches: [
          { id: "org-1", name: "Studio Co", slug: "studio-co" },
          { id: "org-2", name: "Studio Two", slug: "studio-two" },
        ],
      }),
    ).toBe("Organization: Studio Co +1 more");
    expect(
      describeOrganizationFilter(undefined, {
        organizationId: "org-1",
        truncated: false,
        matches: [],
      }),
    ).toBe("Organization: selected organization");
    expect(describeOrganizationFilter("studio", undefined)).toBe(
      "Organization: studio",
    );
    expect(describeOrganizationFilter(undefined, undefined)).toBeNull();
  });

  it("renders empty and fully populated active-filter summaries", () => {
    const { rerender } = render(<ActiveFilters q="" />);
    expect(screen.getByText(/No filters applied/)).toBeInTheDocument();

    rerender(
      <ActiveFilters
        q="camera"
        organization="studio"
        family="equipment"
        subtype="camera"
        tags={["pro", "indoor"]}
        availabilityStatus="available"
        minDailyPrice={10}
        maxDailyPrice={90}
        latitude={43.7}
        longitude={-79.4}
        radiusKm={15}
        startAt="2026-08-01"
      />,
    );
    expect(screen.getByText("9 active")).toBeInTheDocument();
    expect(screen.getByText("Price: 10 - 90")).toBeInTheDocument();
    expect(screen.getByText(/within 15 km/)).toBeInTheDocument();
    expect(screen.getByText("Date window")).toBeInTheDocument();

    rerender(
      <ActiveFilters
        q=""
        minDailyPrice={undefined}
        maxDailyPrice={50}
        latitude={1}
        longitude={2}
        radiusKm={0}
        endAt="2026-08-02"
      />,
    );
    expect(screen.getByText("Price: 0 - 50")).toBeInTheDocument();
    expect(screen.getByText("Near 1, 2")).toBeInTheDocument();
  });

  it("renders filter building blocks with active, inactive, hint, and no-hint states", () => {
    const { rerender } = render(
      <>
        <FilterChip href="/one" active>
          Active
        </FilterChip>
        <FilterChip href="/two">Inactive</FilterChip>
        <FilterPanel title="Category" description="Choose one">
          <span>Panel body</span>
        </FilterPanel>
        <Field label="Query" htmlFor="query" hint="Try camera">
          <input id="query" />
        </Field>
      </>,
    );
    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute(
      "href",
      "/one",
    );
    expect(screen.getByText("Panel body")).toBeInTheDocument();
    expect(screen.getByText("Try camera")).toBeInTheDocument();
    expect(screen.getByLabelText("Query")).toBeInTheDocument();

    rerender(
      <Field label="No hint">
        <span>Child</span>
      </Field>,
    );
    expect(screen.queryByText("Try camera")).not.toBeInTheDocument();
  });
});
