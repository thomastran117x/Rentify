import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { PostingManagementWorkspace } from "./posting-management-workspace";
import { ApiClientError } from "@/lib/api/types";

const {
  replaceMock,
  listMineMock,
  getPostingMock,
  createPostingMock,
  createUploadUrlMock,
  useAuthMock,
  showErrorModalMock,
} = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  listMineMock: vi.fn(),
  getPostingMock: vi.fn(),
  createPostingMock: vi.fn(),
  createUploadUrlMock: vi.fn(),
  useAuthMock: vi.fn(),
  showErrorModalMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/components/errors", async () => {
  const actual = await vi.importActual<typeof import("@/components/errors")>(
    "@/components/errors",
  );

  return {
    ...actual,
    useErrorModal: () => ({
      showErrorModal: showErrorModalMock,
    }),
  };
});

vi.mock("@/lib/postings/api", () => ({
  postingsApi: {
    listMine: listMineMock,
    getPosting: getPostingMock,
    listSeasonalPricing: vi.fn(async () => []),
    create: createPostingMock,
    update: vi.fn(),
    publish: vi.fn(),
    pausePosting: vi.fn(),
    unpausePosting: vi.fn(),
    archive: vi.fn(),
  },
}));

vi.mock("@/lib/blob/api", () => ({
  blobApi: {
    createUploadUrl: createUploadUrlMock,
  },
}));

function managerSession() {
  return {
    status: "authenticated",
    session: {
      accessToken: "token",
      device: { known: true, knownByIp: true },
      user: {
        id: "user-1",
        email: "manager@example.com",
        username: "manager",
        role: "owner",
        organizationMembershipCount: 1,
        activeOrganization: {
          id: "org-1",
          name: "Org 1",
          role: "manager",
        },
      },
    },
  };
}

const samplePosting = {
  id: "posting-1",
  organizationId: "org-1",
  status: "draft",
  variant: { family: "place", subtype: "workspace" },
  name: "Studio day office",
  description: "A flexible studio workspace.",
  pricing: { currency: "CAD", daily: { amount: 120 } },
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
};

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByPlaceholderText("Downtown creative studio"),
    "Downtown studio",
  );
  await user.type(
    screen.getByPlaceholderText(
      "Describe the space, what's included, and who it's great for.",
    ),
    "A bright, flexible studio in the core.",
  );
}

describe("PostingManagementWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/postings/create");
    window.URL.createObjectURL = vi.fn(() => "blob:preview");
    window.URL.revokeObjectURL = vi.fn();

    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: {
        accessToken: "token",
        device: { known: true, knownByIp: true },
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
    });

    listMineMock.mockResolvedValue({
      postings: [samplePosting],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
    getPostingMock.mockResolvedValue(samplePosting);
    createUploadUrlMock.mockResolvedValue({
      method: "PUT",
      uploadUrl: "https://blob.example/upload",
      expiresAt: "2026-06-01T00:00:00.000Z",
      blobName: "postings/photo.png",
      blobUrl: "https://blob.example/postings/photo.png",
      container: "postings",
      headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "image/png" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window.URL as { createObjectURL?: unknown }).createObjectURL;
    delete (window.URL as { revokeObjectURL?: unknown }).revokeObjectURL;
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

  it("opens a posting straight into the wizard from a ?posting deep link", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/postings/create?posting=posting-1");

    render(<PostingManagementWorkspace />);

    await waitFor(() => {
      expect(getPostingMock).toHaveBeenCalledWith("posting-1");
    });

    await user.click(await screen.findByRole("button", { name: "Basics" }));
    expect(
      await screen.findByDisplayValue("Studio day office"),
    ).toBeInTheDocument();
  });

  it("opens a deep-linked posting even when it is not on the first page", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/postings/create?posting=posting-1");
    // The first page of the owner listing does not contain the requested id.
    listMineMock.mockResolvedValue({
      postings: [{ ...samplePosting, id: "posting-99", name: "Other listing" }],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 21,
        totalPages: 2,
        hasNextPage: true,
        hasPreviousPage: false,
      },
    });

    render(<PostingManagementWorkspace />);

    // It is still fetched directly by id and opened in the wizard.
    await waitFor(() => {
      expect(getPostingMock).toHaveBeenCalledWith("posting-1");
    });
    await user.click(await screen.findByRole("button", { name: "Basics" }));
    expect(
      await screen.findByDisplayValue("Studio day office"),
    ).toBeInTheDocument();
  });

  it("locks forward steps and uses chip tags with structured details", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(managerSession());

    render(<PostingManagementWorkspace />);

    await user.click(
      await screen.findByRole("button", { name: "Create posting" }),
    );

    // Progressive: cannot jump ahead to a step not yet reached.
    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await fillBasics(user);

    // Tags are chips, not a comma string.
    await user.type(
      screen.getByPlaceholderText("Add another…"),
      "rooftop{Enter}",
    );
    expect(screen.getByText("rooftop")).toBeInTheDocument();

    // Advance to the Details step: structured fields, no JSON to hand-edit.
    for (let step = 0; step < 4; step += 1) {
      await user.click(screen.getByRole("button", { name: "Continue" }));
    }
    expect(screen.getByText("Property Type")).toBeInTheDocument();
    expect(screen.queryByText(/JSON/i)).not.toBeInTheDocument();
  });

  it("locks the Continue button until the current step is valid", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(managerSession());

    render(<PostingManagementWorkspace />);

    await user.click(
      await screen.findByRole("button", { name: "Create posting" }),
    );
    await user.click(screen.getByRole("button", { name: "Continue" })); // -> Basics

    // Basics has empty required fields, so Continue is locked with a reason.
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(
      screen.getByText("Complete this step to continue"),
    ).toBeInTheDocument();

    // Filling the required fields unlocks it.
    await fillBasics(user);
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("previews uploaded photos and lets you choose the primary", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(managerSession());

    render(<PostingManagementWorkspace />);

    await user.click(
      await screen.findByRole("button", { name: "Create posting" }),
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await fillBasics(user);
    for (let step = 0; step < 4; step += 1) {
      await user.click(screen.getByRole("button", { name: "Continue" }));
    }

    await user.upload(screen.getByLabelText("Upload photos"), [
      new File(["a"], "one.png", { type: "image/png" }),
      new File(["b"], "two.png", { type: "image/png" }),
    ]);

    // Both photos render a preview; the first is primary by default.
    expect(screen.getAllByAltText("Posting photo preview")).toHaveLength(2);
    expect(screen.getByText("Primary")).toBeInTheDocument();

    // Exactly one non-primary photo offers "Set primary".
    const setPrimaryButtons = screen.getAllByRole("button", {
      name: "Set primary",
    });
    expect(setPrimaryButtons).toHaveLength(1);
    await user.click(setPrimaryButtons[0]);
    expect(screen.getByText("Primary")).toBeInTheDocument();
  });

  it("shows a listing preview with the photo on the review step", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(managerSession());

    render(<PostingManagementWorkspace />);

    await user.click(
      await screen.findByRole("button", { name: "Create posting" }),
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await fillBasics(user);
    for (let step = 0; step < 4; step += 1) {
      await user.click(screen.getByRole("button", { name: "Continue" }));
    }
    await user.upload(
      screen.getByLabelText("Upload photos"),
      new File(["a"], "one.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "Continue" })); // -> Review

    expect(screen.getByText("Listing preview")).toBeInTheDocument();
    // The preview renders the listing as renters will see it.
    expect(
      screen.getByRole("heading", { name: "Downtown studio" }),
    ).toBeInTheDocument();
    expect(screen.getByAltText("Primary photo preview")).toBeInTheDocument();
  });

  it("jumps to a step from the review section navigator", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(managerSession());

    render(<PostingManagementWorkspace />);

    await user.click(
      await screen.findByRole("button", { name: "Create posting" }),
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await fillBasics(user);
    for (let step = 0; step < 4; step += 1) {
      await user.click(screen.getByRole("button", { name: "Continue" }));
    }
    await user.upload(
      screen.getByLabelText("Upload photos"),
      new File(["a"], "one.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "Continue" })); // -> Review

    // The navigator row (distinct from the stepper pill) jumps back to editing.
    await user.click(screen.getByRole("button", { name: /Basics.*Edit/ }));
    expect(screen.getByDisplayValue("Downtown studio")).toBeInTheDocument();
  });

  it("swaps the preview hero when a thumbnail is clicked", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(managerSession());
    window.URL.createObjectURL = vi.fn((file: File) => `blob:${file.name}`);

    render(<PostingManagementWorkspace />);

    await user.click(
      await screen.findByRole("button", { name: "Create posting" }),
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await fillBasics(user);
    for (let step = 0; step < 4; step += 1) {
      await user.click(screen.getByRole("button", { name: "Continue" }));
    }
    await user.upload(screen.getByLabelText("Upload photos"), [
      new File(["a"], "one.png", { type: "image/png" }),
      new File(["b"], "two.png", { type: "image/png" }),
    ]);
    await user.click(screen.getByRole("button", { name: "Continue" })); // -> Review

    const hero = screen.getByAltText(
      "Primary photo preview",
    ) as HTMLImageElement;
    expect(hero.src).toContain("one.png");

    await user.click(screen.getByRole("button", { name: "Show photo 2" }));
    expect(
      (screen.getByAltText("Primary photo preview") as HTMLImageElement).src,
    ).toContain("two.png");
  });

  it("surfaces backend validation details when a save fails", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(managerSession());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true }) as Response),
    );
    createPostingMock.mockRejectedValue(
      new ApiClientError("Request body validation failed.", {
        code: "VALIDATION_ERROR",
        status: 400,
        request: {
          method: "POST",
          path: "/postings",
          requestUrl: "http://localhost:8040/api/v1/postings",
        },
        details: [
          {
            path: "pricing.daily.amount",
            message: "Number must be greater than 0",
          },
        ],
      }),
    );

    render(<PostingManagementWorkspace />);

    await user.click(
      await screen.findByRole("button", { name: "Create posting" }),
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await fillBasics(user);
    for (let step = 0; step < 4; step += 1) {
      await user.click(screen.getByRole("button", { name: "Continue" }));
    }
    await user.upload(
      screen.getByLabelText("Upload photos"),
      new File(["a"], "one.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "Continue" })); // -> Review
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => {
      expect(showErrorModalMock).toHaveBeenCalled();
    });

    const call = showErrorModalMock.mock.calls.at(-1)?.[0];
    expect(call.title).toBe("Couldn't save posting");
    // The modal message is a node listing every field-level detail.
    const { getByText } = render(<>{call.message}</>);
    expect(getByText(/Number must be greater than 0/)).toBeInTheDocument();
  });
});
