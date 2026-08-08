import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PostingsPage from "./page";

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));

vi.mock("@/lib/postings/search", () => ({
  searchPublicPostings: searchMock,
  PublicPostingSearchError: class PublicPostingSearchError extends Error {
    constructor(
      message: string,
      readonly debug: Record<string, unknown>,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/components/common/pagination", () => ({
  PaginationLinks: () => <div>Pagination</div>,
}));
vi.mock("@/components/postings/posting-search-form", () => ({
  PostingSearchForm: () => <div>Search form</div>,
}));
vi.mock("@/components/postings/posting-result-card", () => ({
  PostingResultCard: () => <article>Posting result</article>,
}));
vi.mock("@/components/postings/save-posting-button", () => ({
  SavePostingButton: () => <button>Save</button>,
}));
vi.mock("@/components/postings/posting-autocomplete-input", () => ({
  PostingAutocompleteInput: () => <input aria-label="Search rentals" />,
}));
vi.mock("@/components/postings/organization-filter-field", () => ({
  OrganizationFilterField: () => <input aria-label="Organization" />,
}));

describe("PostingsPage", () => {
  it("parses supported query parameters and renders an empty search result", async () => {
    searchMock.mockResolvedValue({
      postings: [],
      source: "database",
      organizationFilter: undefined,
      pagination: {
        page: 2,
        pageSize: 50,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    });

    render(
      await PostingsPage({
        searchParams: Promise.resolve({
          q: " camera ",
          sort: "newest",
          page: "2",
          pageSize: "50",
          family: "equipment",
          subtype: "camera",
          tags: ["indoor,pro", "featured"],
          availabilityStatus: "available",
          minDailyPrice: "10",
          maxDailyPrice: "90",
          latitude: "43.7",
          longitude: "-79.4",
          radiusKm: "15",
          startAt: "2026-08-01",
          endAt: "2026-08-03",
        }),
      }),
    );

    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "camera",
        sort: "newest",
        page: 2,
        pageSize: 50,
        family: "equipment",
        subtype: "camera",
        tags: ["indoor", "pro", "featured"],
        availabilityStatus: "available",
        minDailyPrice: 10,
        maxDailyPrice: 90,
        latitude: 43.7,
        longitude: -79.4,
        radiusKm: 15,
      }),
    );
    expect(
      screen.getByText(
        "No postings matched your search. Try broadening your filters.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Pagination")).toBeInTheDocument();
  });

  it("renders a useful error when the search API fails", async () => {
    searchMock.mockRejectedValue(new Error("Search service unavailable"));

    render(
      await PostingsPage({
        searchParams: Promise.resolve({
          sort: "not-a-sort",
          page: "0",
          pageSize: "7",
        }),
      }),
    );

    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "relevance", page: 1, pageSize: 20 }),
    );
    expect(screen.getByText("Search service unavailable")).toBeInTheDocument();
  });

  it("groups organization-sorted results and reports a truncated organization match", async () => {
    searchMock.mockResolvedValue({
      postings: [
        {
          id: "posting-1",
          name: "Camera",
          organization: { id: "org-1", name: "Studio Co", slug: "studio-co" },
        },
      ],
      source: "elasticsearch",
      organizationFilter: {
        query: "studio",
        truncated: true,
        matches: [{ id: "org-1", name: "Studio Co" }],
      },
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });

    render(
      await PostingsPage({
        searchParams: Promise.resolve({
          sort: "organizationAsc",
          organization: "studio",
        }),
      }),
    );

    expect(screen.getByText("Studio Co")).toBeInTheDocument();
    expect(
      screen.getByText(/Many organizations matched that name/),
    ).toBeInTheDocument();
    expect(screen.getByText("Posting result")).toBeInTheDocument();
  });

  it("offers to clear an organization filter that has no matching organization", async () => {
    searchMock.mockResolvedValue({
      postings: [],
      source: "database",
      organizationFilter: { query: "missing", truncated: false, matches: [] },
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });

    render(
      await PostingsPage({
        searchParams: Promise.resolve({ organization: "missing" }),
      }),
    );

    expect(screen.getByText(/No organization matches/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Clear the organization filter" }),
    ).toHaveAttribute("href", "/postings?sort=relevance&page=1&pageSize=20");
  });

  it("normalizes arrays, empty tags, unsupported filters, and invalid numbers", async () => {
    searchMock.mockResolvedValue({
      postings: [],
      source: "database",
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
    render(
      await PostingsPage({
        searchParams: Promise.resolve({
          q: [" first ", "ignored"],
          sort: ["oldest"],
          page: ["NaN"],
          pageSize: ["-2"],
          family: "unknown",
          subtype: "unknown",
          tags: [" , ", "one,,two"],
          availabilityStatus: "unknown",
          minDailyPrice: "wat",
          maxDailyPrice: "",
          latitude: "x",
          longitude: "-79.4",
          radiusKm: "0",
          organization: [" studio "],
          organizationId: "not-a-uuid",
          startAt: "",
          endAt: "",
        }),
      }),
    );
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "first",
        sort: "oldest",
        page: 1,
        pageSize: 20,
        tags: ["one", "two"],
        longitude: -79.4,
        radiusKm: 0,
        organization: "studio",
      }),
    );
  });

  it.each([
    [
      { causeMessage: "fetch failed" },
      "Search is temporarily unavailable",
      /couldn't reach Rentify search/,
    ],
    [{ status: 400 }, "Invalid search request", /filter values were rejected/],
    [{ status: 503 }, "Search is temporarily unavailable", /having trouble/],
    [{ status: 403 }, "Search results could not be loaded", /Denied/],
  ])(
    "renders categorized search failures",
    async (debug, title, description) => {
      const { PublicPostingSearchError } = await import(
        "@/lib/postings/search"
      );
      searchMock.mockRejectedValue(
        new PublicPostingSearchError("Denied", {
          requestUrl: "/postings",
          params: {},
          ...debug,
        }),
      );
      render(await PostingsPage({ searchParams: Promise.resolve({}) }));
      expect(screen.getByText(title)).toBeInTheDocument();
      expect(screen.getByText(description)).toBeInTheDocument();
    },
  );
});
