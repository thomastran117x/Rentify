import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlogSearchPage } from "./blog-search-page";

const searchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/organizations/api", () => ({
  organizationsApi: { searchBlogFeed: searchMock },
}));
vi.mock("@/lib/api/user-messages", () => ({
  getApiErrorMessage: () => "Blog service unavailable",
}));
vi.mock("@/components/common/pagination", () => ({
  Pagination: () => <div>Pagination</div>,
}));
vi.mock("@/components/organizations/organization-public-visuals", () => ({
  formatOrganizationDate: () => "Today",
}));
vi.mock("@/components/organizations/blog-visuals", () => ({
  AuthorAvatar: () => <span>Avatar</span>,
  authorName: () => "Author",
  displayReadingMinutes: () => 2,
}));
vi.mock("@/lib/organizations/urls", () => ({
  organizationHref: (...parts: string[]) => `/organizations/${parts.join("/")}`,
}));

const result = (posts: object[]) => ({
  posts,
  pagination: {
    total: posts.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
});
const post = {
  id: "post-1",
  organizationId: "org-1",
  slug: "opening",
  title: "Opening day",
  tags: ["news"],
  createdAt: "2026-01-01",
  organization: { name: "Studio", slug: "studio" },
};

describe("BlogSearchPage", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders featured posts and searches with a trimmed query", async () => {
    searchMock.mockResolvedValue(
      result([post, { ...post, id: "post-2", title: "Second" }]),
    );
    render(<BlogSearchPage />);
    await waitFor(() =>
      expect(screen.getByText("Featured")).toBeInTheDocument(),
    );
    expect(screen.getByText("2 published posts")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search all blog posts"), {
      target: { value: "  launch  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(searchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "launch" }),
      ),
    );
  });

  it("renders error and searched-empty states", async () => {
    searchMock.mockRejectedValueOnce(new Error("offline"));
    const { unmount } = render(<BlogSearchPage />);
    await screen.findByText("Blog service unavailable");
    unmount();

    searchMock.mockResolvedValue(result([]));
    render(<BlogSearchPage />);
    await screen.findByText("No posts yet");
    fireEvent.change(screen.getByLabelText("Search all blog posts"), {
      target: { value: "missing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("No matching posts");
  });
});
