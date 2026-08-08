import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationBlogListPage } from "./organization-blog-list-page";

const listMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/organizations/api", () => ({
  organizationsApi: { listPublicBlog: listMock },
}));
vi.mock("@/lib/api/user-messages", () => ({
  getApiErrorMessage: () => "Blog unavailable",
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

const post = {
  id: "post-1",
  organizationId: "org-1",
  slug: "opening",
  title: "Opening day",
  tags: ["news", "guide"],
  createdAt: "2026-01-01",
};
const response = (posts: object[]) => ({
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

describe("OrganizationBlogListPage", () => {
  afterEach(() => vi.clearAllMocks());

  it("loads a featured organization post and filters it by tag", async () => {
    listMock.mockResolvedValue(
      response([post, { ...post, id: "post-2", title: "Guide" }]),
    );
    render(<OrganizationBlogListPage id="org-1" organizationSlug="studio" />);
    await screen.findByText("Featured");
    expect(
      screen.getByRole("link", { name: /Back to organization/ }),
    ).toHaveAttribute("href", "/organizations/studio");
    fireEvent.click(screen.getByRole("button", { name: "news" }));
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        "org-1",
        expect.objectContaining({ tag: "news" }),
      ),
    );
  });

  it("shows API failure and query-specific empty messaging", async () => {
    listMock.mockRejectedValueOnce(new Error("offline"));
    const { unmount } = render(<OrganizationBlogListPage id="org-1" />);
    await screen.findByText("Blog unavailable");
    unmount();
    listMock.mockResolvedValue(response([]));
    render(<OrganizationBlogListPage id="org-1" />);
    await screen.findByText("No posts yet");
    fireEvent.change(screen.getByLabelText("Search blog posts"), {
      target: { value: "missing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("No matching posts");
  });
});
