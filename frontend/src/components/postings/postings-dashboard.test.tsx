import { render, screen, waitFor } from "@testing-library/react";
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
} = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  useAuthMock: vi.fn(),
  showErrorMock: vi.fn(),
  listMineMock: vi.fn(),
  getStatusSummaryMock: vi.fn(),
  publishMock: vi.fn(),
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
    pausePosting: vi.fn(),
    unpausePosting: vi.fn(),
    archive: vi.fn(),
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
});
