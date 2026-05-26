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
});
