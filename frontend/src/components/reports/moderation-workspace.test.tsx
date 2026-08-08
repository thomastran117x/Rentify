import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModerationWorkspace } from "./moderation-workspace";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const {
  useAuthMock,
  listModerationMock,
  getModerationReportMock,
  assignMock,
  updateStatusMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  listModerationMock: vi.fn(),
  getModerationReportMock: vi.fn(),
  assignMock: vi.fn(),
  updateStatusMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
  }),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/reports/api", () => ({
  reportsApi: {
    listModeration: listModerationMock,
    getModerationReport: getModerationReportMock,
    assign: assignMock,
    updateStatus: updateStatusMock,
  },
}));

describe("ModerationWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: {
        user: {
          role: "moderator",
        },
      },
    });

    listModerationMock.mockResolvedValue({
      reports: [
        {
          id: "report-1",
          reporterId: "user-1",
          subjectType: "posting",
          subjectId: "posting-1",
          reasonCode: "spam",
          title: "Looks suspicious",
          description: "The listing asks for payment off-platform.",
          status: "open",
          createdAt: "2026-05-20T12:00:00.000Z",
          updatedAt: "2026-05-20T12:00:00.000Z",
          reporter: {
            id: "user-1",
            email: "user@example.com",
            role: "user",
          },
          subjectSnapshot: {
            subjectType: "posting",
            summaryText: "Posting snapshot",
          },
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
      source: "database",
    });
    getModerationReportMock.mockResolvedValue({
      id: "report-1",
      reporterId: "user-1",
      subjectType: "posting",
      subjectId: "posting-1",
      reasonCode: "spam",
      title: "Looks suspicious",
      description: "The listing asks for payment off-platform.",
      status: "open",
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:00:00.000Z",
      reporter: {
        id: "user-1",
        email: "user@example.com",
        role: "user",
      },
      subjectSnapshot: {
        subjectType: "posting",
        summaryText: "Posting snapshot",
      },
      events: [
        {
          id: "event-1",
          eventType: "created",
          actor: {
            id: "user-1",
            email: "user@example.com",
            role: "user",
          },
          createdAt: "2026-05-20T12:00:00.000Z",
        },
      ],
    });
    assignMock.mockResolvedValue({ id: "report-1" });
    updateStatusMock.mockResolvedValue({ id: "report-1" });
  });

  it("redirects anonymous users to login", async () => {
    useAuthMock.mockReturnValue({
      status: "anonymous",
      session: null,
    });

    render(<ModerationWorkspace />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith(
        "/login?next=%2Fmoderation",
      );
    });
  });

  it("loads the queue and submits a status update", async () => {
    render(<ModerationWorkspace />);

    expect(await screen.findByText("Looks suspicious")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Resolve report" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Resolution summary"), {
      target: { value: "Removed after manual verification." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve report" }));

    await waitFor(() => {
      expect(updateStatusMock).toHaveBeenCalledWith("report-1", {
        status: "resolved",
        resolutionCode: "action_taken",
        resolutionSummary: "Removed after manual verification.",
        note: undefined,
      });
    });
  });

  it("shows loading and denies non-moderator roles", () => {
    useAuthMock.mockReturnValue({ status: "loading", session: null });
    const { rerender } = render(<ModerationWorkspace />);
    expect(
      screen.getByText("Loading moderation workspace..."),
    ).toBeInTheDocument();

    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: { user: { role: "owner" } },
    });
    rerender(<ModerationWorkspace />);
    expect(
      screen.getByText(/Moderation access is limited/),
    ).toBeInTheDocument();
    expect(listModerationMock).not.toHaveBeenCalled();
  });

  it("renders empty queues and queue failures", async () => {
    listModerationMock.mockResolvedValueOnce({
      reports: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      source: "database",
    });
    const { unmount } = render(<ModerationWorkspace />);
    expect(
      await screen.findByText("No reports match these filters."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pick a report from the queue to inspect the full record.",
      ),
    ).toBeInTheDocument();
    unmount();

    listModerationMock.mockRejectedValueOnce(new Error("offline"));
    render(<ModerationWorkspace />);
    expect(
      await screen.findByText(/couldn't load the report queue/i),
    ).toBeInTheDocument();
  });

  it("filters the queue and changes the selected report", async () => {
    listModerationMock.mockResolvedValue({
      reports: [
        {
          id: "report-1",
          reporterId: "user-1",
          subjectType: "posting",
          subjectId: "posting-1",
          reasonCode: "spam",
          title: "First report",
          description: "First",
          status: "open",
          createdAt: "2026-05-20T12:00:00.000Z",
          updatedAt: "2026-05-20T12:00:00.000Z",
          reporter: { id: "user-1", email: "one@example.com", role: "user" },
          subjectSnapshot: { subjectType: "posting", summaryText: "First" },
        },
        {
          id: "report-2",
          reporterId: "user-2",
          subjectType: "user",
          subjectId: "user-2",
          reasonCode: "harassment",
          title: "Second report",
          description: "Second",
          status: "under_review",
          createdAt: "2026-05-21T12:00:00.000Z",
          updatedAt: "2026-05-21T12:00:00.000Z",
          reporter: { id: "user-2", email: "two@example.com", role: "user" },
          subjectSnapshot: { subjectType: "user", summaryText: "Second" },
        },
      ],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 2,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      source: "elasticsearch",
    });
    render(<ModerationWorkspace />);
    await screen.findByText("First report");
    fireEvent.change(
      screen.getByPlaceholderText("Title, description, or user"),
      {
        target: { value: "second" },
      },
    );
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "under_review" } });
    fireEvent.change(selects[1], { target: { value: "user" } });
    fireEvent.change(selects[2], {
      target: { value: "harassment_or_hate" },
    });
    await waitFor(() =>
      expect(listModerationMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          q: "second",
          status: "under_review",
          subjectType: "user",
          reasonCode: "harassment_or_hate",
          page: 1,
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /Second report/ }));
    await waitFor(() =>
      expect(getModerationReportMock).toHaveBeenCalledWith("report-2"),
    );
  });

  it("assigns, unassigns, and moves reports through nonterminal statuses", async () => {
    render(<ModerationWorkspace />);
    await screen.findByRole("button", { name: "Assign to me" });
    fireEvent.click(screen.getByRole("button", { name: "Assign to me" }));
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith("report-1", {}),
    );
    expect(await screen.findByText("Report assigned.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unassign" }));
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith("report-1", {
        assignedModeratorId: null,
      }),
    );
    fireEvent.change(screen.getByLabelText("Internal note"), {
      target: { value: "  Needs a closer look  " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Move to under review" }),
    );
    await waitFor(() =>
      expect(updateStatusMock).toHaveBeenCalledWith("report-1", {
        status: "under_review",
        resolutionCode: undefined,
        resolutionSummary: undefined,
        note: "Needs a closer look",
      }),
    );
  });

  it("renders optional detail metadata and dismisses a report", async () => {
    getModerationReportMock.mockResolvedValue({
      id: "report-1",
      reporterId: "user-1",
      subjectType: "posting",
      subjectId: "posting-1",
      reasonCode: "spam",
      title: "Looks suspicious",
      description: "Description",
      status: "under_review",
      resolutionCode: "no_violation",
      resolutionSummary: "Already reviewed",
      reviewedAt: "2026-05-22T12:00:00.000Z",
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-22T12:00:00.000Z",
      reporter: {
        id: "user-1",
        email: "user@example.com",
        username: "reporter",
        role: "user",
      },
      assignedModerator: {
        id: "mod-1",
        email: "mod@example.com",
        username: "moderator",
        role: "moderator",
      },
      subjectSnapshot: { subjectType: "posting", summaryText: "Snapshot" },
      events: [
        {
          id: "event-1",
          eventType: "note_added",
          actor: {
            id: "mod-1",
            email: "mod@example.com",
            username: "moderator",
            role: "moderator",
          },
          note: "Investigated",
          createdAt: "2026-05-22T12:00:00.000Z",
        },
      ],
    });
    render(<ModerationWorkspace />);
    expect(await screen.findByText("Investigated")).toBeInTheDocument();
    expect(screen.getAllByText("moderator").length).toBeGreaterThan(0);
    expect(screen.getByText(/Reviewed:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss report" }));
    await waitFor(() =>
      expect(updateStatusMock).toHaveBeenCalledWith(
        "report-1",
        expect.objectContaining({
          status: "dismissed",
          resolutionCode: "no_violation",
          resolutionSummary: "Already reviewed",
        }),
      ),
    );
  });
});
