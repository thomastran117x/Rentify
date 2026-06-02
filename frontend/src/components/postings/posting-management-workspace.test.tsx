import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PostingManagementWorkspace } from "./posting-management-workspace";

const { replaceMock, listMineMock, getPostingMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  listMineMock: vi.fn(),
  getPostingMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: () => ({
    status: "authenticated",
    session: {
      accessToken: "token",
      device: {
        known: true,
        knownByIp: true,
      },
      user: {
        id: "user-1",
        email: "user@example.com",
        username: "user",
        role: "user",
        organizationMembershipCount: 1,
        activeOrganization: {
          id: "org-1",
          name: "Org 1",
          role: "operator",
        },
      },
    },
  }),
}));

vi.mock("@/lib/postings/api", () => ({
  postingsApi: {
    listMine: listMineMock,
    getPosting: getPostingMock,
    create: vi.fn(),
    update: vi.fn(),
    publish: vi.fn(),
    pausePosting: vi.fn(),
    unpausePosting: vi.fn(),
    archive: vi.fn(),
  },
}));

vi.mock("@/lib/blob/api", () => ({
  blobApi: {
    createUploadUrl: vi.fn(),
  },
}));

describe("PostingManagementWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMineMock.mockResolvedValue({
      postings: [
        {
          id: "posting-1",
          organizationId: "org-1",
          status: "draft",
          variant: {
            family: "place",
            subtype: "workspace",
          },
          name: "Studio day office",
          description: "A flexible studio workspace.",
          pricing: {
            currency: "CAD",
            daily: {
              amount: 120,
            },
          },
          pricingCurrency: "CAD",
          photos: [],
          tags: ["studio"],
          details: {
            guest_capacity: 4,
            property_type: "studio",
            amenities: ["wifi"],
          },
          availabilityStatus: "available",
          effectiveMaxBookingDurationDays: 14,
          availabilityBlocks: [],
          location: {
            city: "Toronto",
            region: "Ontario",
            country: "Canada",
            latitude: 43.65,
            longitude: -79.38,
          },
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
    getPostingMock.mockResolvedValue({
      id: "posting-1",
      organizationId: "org-1",
      status: "draft",
      variant: {
        family: "place",
        subtype: "workspace",
      },
      name: "Studio day office",
      description: "A flexible studio workspace.",
      pricing: {
        currency: "CAD",
        daily: {
          amount: 120,
        },
      },
      pricingCurrency: "CAD",
      photos: [],
      tags: ["studio"],
      details: {
        guest_capacity: 4,
        property_type: "studio",
        amenities: ["wifi"],
      },
      availabilityStatus: "available",
      effectiveMaxBookingDurationDays: 14,
      availabilityBlocks: [],
      location: {
        city: "Toronto",
        region: "Ontario",
        country: "Canada",
        latitude: 43.65,
        longitude: -79.38,
      },
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
  });

  it("shows operator access as read-only", async () => {
    render(<PostingManagementWorkspace />);

    await waitFor(() => {
      expect(screen.getByText("Studio day office")).toBeInTheDocument();
    });

    expect(screen.getByText(/read-only access/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create draft" }),
    ).not.toBeInTheDocument();
  });
});
