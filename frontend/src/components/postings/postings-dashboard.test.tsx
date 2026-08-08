import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostingsDashboard } from "./postings-dashboard";

const {
  replaceMock,
  useAuthMock,
  showErrorMock,
  listMineMock,
  getStatusSummaryMock,
  publishMock,
  pauseMock,
  unpauseMock,
  archiveMock,
} = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  useAuthMock: vi.fn(),
  showErrorMock: vi.fn(),
  listMineMock: vi.fn(),
  getStatusSummaryMock: vi.fn(),
  publishMock: vi.fn(),
  pauseMock: vi.fn(),
  unpauseMock: vi.fn(),
  archiveMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/components/errors", () => ({
  useErrorToast: () => ({ showError: showErrorMock }),
}));

vi.mock("@/lib/postings/api", () => ({
  postingsApi: {
    listMine: listMineMock,
    getStatusSummary: getStatusSummaryMock,
    publish: publishMock,
    pausePosting: pauseMock,
    unpausePosting: unpauseMock,
    archive: archiveMock,
  },
}));

function makePosting(overrides: Record<string, unknown> = {}) {
  return {
    id: "posting-1",
    organizationId: "org-1",
    status: "draft",
    name: "Downtown studio",
    variant: { family: "place", subtype: "workspace" },
    pricing: { currency: "CAD", daily: { amount: 120 } },
    pricingCurrency: "CAD",
    location: { city: "Toronto", region: "Ontario", country: "Canada" },
    tags: [],
    photos: [],
    details: {},
    availabilityStatus: "available",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  };
}

function paginated(
  postings: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    postings,
    pagination: {
      page: 1,
      pageSize: 10,
      total: postings.length,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
      ...overrides,
    },
  };
}

describe("PostingsDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: {
        accessToken: "token",
        user: {
          id: "user-1",
          email: "manager@example.com",
          username: "manager",
          role: "owner",
          activeOrganization: {
            id: "org-1",
            name: "Org 1",
            role: "manager",
          },
        },
      },
    });
    getStatusSummaryMock.mockResolvedValue({
      total: 2,
      byStatus: { draft: 1, published: 1, paused: 0, archived: 0 },
    });
    listMineMock.mockResolvedValue(paginated([makePosting()]));
    publishMock.mockResolvedValue(undefined);
    pauseMock.mockResolvedValue(undefined);
    unpauseMock.mockResolvedValue(undefined);
    archiveMock.mockResolvedValue(undefined);
  });

  it("renders postings with status counts", async () => {
    render(<PostingsDashboard />);

    expect(await screen.findByText("Downtown studio")).toBeInTheDocument();
    // Status tabs show counts from the summary endpoint.
    expect(screen.getByRole("button", { name: /All 2/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Published 1/ }),
    ).toBeInTheDocument();
  });

  it("searches with a debounced query", async () => {
    const user = userEvent.setup();
    render(<PostingsDashboard />);

    await screen.findByText("Downtown studio");
    await user.type(screen.getByLabelText("Search postings"), "loft");

    await waitFor(() => {
      expect(listMineMock).toHaveBeenCalledWith(
        expect.objectContaining({ q: "loft" }),
      );
    });
  });

  it("filters by status when a tab is selected", async () => {
    const user = userEvent.setup();
    render(<PostingsDashboard />);

    await screen.findByText("Downtown studio");
    await user.click(screen.getByRole("button", { name: /Draft 1/ }));

    await waitFor(() => {
      expect(listMineMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "draft" }),
      );
    });
  });

  it("shows the primary photo thumbnail", async () => {
    listMineMock.mockResolvedValue(
      paginated([
        makePosting({
          name: "Sunny loft",
          photos: [
            {
              id: "photo-1",
              blobUrl: "https://cdn.rentify.test/loft.jpg",
              thumbnailBlobUrl: "https://cdn.rentify.test/loft-thumb.jpg",
              position: 0,
            },
          ],
        }),
      ]),
    );

    render(<PostingsDashboard />);

    const image = await screen.findByRole("img", { name: "Sunny loft" });
    expect(image).toHaveAttribute(
      "src",
      "https://cdn.rentify.test/loft-thumb.jpg",
    );
  });

  it("converts a posting's status", async () => {
    const user = userEvent.setup();
    render(<PostingsDashboard />);

    await screen.findByText("Downtown studio");
    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(publishMock).toHaveBeenCalledWith("posting-1");
    });
  });

  it("requests the next page of postings", async () => {
    const user = userEvent.setup();
    listMineMock.mockResolvedValue(
      paginated([makePosting()], {
        totalPages: 3,
        total: 25,
        hasNextPage: true,
      }),
    );

    render(<PostingsDashboard />);

    await screen.findByText("Downtown studio");
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => {
      expect(listMineMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2, pageSize: 10 }),
      );
    });
  });

  it("keeps the selected page when the search debounce settles on mount", async () => {
    listMineMock.mockResolvedValue(
      paginated([makePosting()], {
        totalPages: 3,
        total: 25,
        hasNextPage: true,
      }),
    );

    render(<PostingsDashboard />);
    await screen.findByText("Downtown studio");

    // fireEvent, not userEvent: this must land inside the 350ms mount-debounce
    // window, and userEvent's timer advancement would close that window first.
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => {
      expect(listMineMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      );
    });

    // Let the debounce window elapse; it must not reset the page to 1.
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(listMineMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );
  });

  it("returns to the first page when the page size changes", async () => {
    const user = userEvent.setup();
    listMineMock.mockResolvedValue(
      paginated([makePosting()], {
        page: 3,
        totalPages: 3,
        total: 25,
        hasPreviousPage: true,
      }),
    );

    render(<PostingsDashboard />);

    await screen.findByText("Downtown studio");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Per page" }),
      "50",
    );

    await waitFor(() => {
      expect(listMineMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, pageSize: 50 }),
      );
    });
  });

  it("renders loading, anonymous, no-organization, and read-only states", async () => {
    useAuthMock.mockReturnValue({ status: "loading", session: null });
    const { rerender } = render(<PostingsDashboard />);
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();

    useAuthMock.mockReturnValue({ status: "anonymous", session: null });
    rerender(<PostingsDashboard />);
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/login?next=/postings/manage"),
    );

    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: { user: { role: "owner" } },
    });
    rerender(<PostingsDashboard />);
    expect(
      screen.getByText("Select an organization first"),
    ).toBeInTheDocument();

    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: {
        user: {
          role: "user",
          activeOrganization: { id: "org-1", name: "Org 1", role: "operator" },
        },
      },
    });
    rerender(<PostingsDashboard />);
    expect(await screen.findByText(/Read-only access/)).toBeInTheDocument();
    expect(screen.queryByText("New posting")).not.toBeInTheDocument();
  });

  it("shows empty and failed list states", async () => {
    listMineMock.mockResolvedValueOnce(paginated([]));
    const { unmount } = render(<PostingsDashboard />);
    expect(await screen.findByText("No postings yet")).toBeInTheDocument();
    unmount();

    listMineMock.mockRejectedValueOnce(new Error("offline"));
    render(<PostingsDashboard />);
    expect(
      await screen.findByText(/couldn't load your postings/i),
    ).toBeInTheDocument();
  });

  it.each([
    ["published", "Pause", pauseMock],
    ["paused", "Unpause", unpauseMock],
    ["archived", null, null],
  ] as const)(
    "renders and runs lifecycle controls for %s",
    async (status, label, actionMock) => {
      const user = userEvent.setup();
      listMineMock.mockResolvedValue(
        paginated([makePosting({ status, name: `${status} posting` })]),
      );
      render(<PostingsDashboard />);
      await screen.findByText(`${status} posting`);
      if (!label || !actionMock) {
        expect(
          screen.queryByRole("button", { name: "Publish" }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: "Pause" }),
        ).not.toBeInTheDocument();
        return;
      }
      await user.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(actionMock).toHaveBeenCalledWith("posting-1"));
    },
  );

  it("surfaces lifecycle failures through inline and toast errors", async () => {
    const user = userEvent.setup();
    publishMock.mockRejectedValue(new Error("offline"));
    render(<PostingsDashboard />);
    await user.click(await screen.findByRole("button", { name: "Publish" }));
    expect(
      await screen.findByText(/couldn't update that posting/i),
    ).toBeInTheDocument();
    expect(showErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't update posting",
        tone: "error",
      }),
    );
  });
});
