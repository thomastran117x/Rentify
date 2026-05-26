import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportDialog } from "./report-dialog";
import { resetRouterMocks, routerPushMock } from "@/test/mocks/next-navigation";

const { useAuthMock, createReportMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  createReportMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
  usePathname: () => "/postings/posting-1",
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/reports/api", () => ({
  reportsApi: {
    create: createReportMock,
  },
}));

describe("ReportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: {
        user: {
          role: "user",
        },
      },
    });
    createReportMock.mockResolvedValue({
      id: "report-1",
    });
  });

  it("redirects anonymous visitors to login before opening the dialog", () => {
    useAuthMock.mockReturnValue({
      status: "anonymous",
      session: null,
    });

    render(
      <ReportDialog
        subjectType="posting"
        subjectId="posting-1"
        subjectLabel="Posting"
        triggerLabel="Report posting"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Report posting" }));

    expect(routerPushMock).toHaveBeenCalledWith(
      "/login?next=%2Fpostings%2Fposting-1",
    );
  });

  it("shows validation feedback before submitting", async () => {
    render(
      <ReportDialog
        subjectType="posting"
        subjectId="posting-1"
        subjectLabel="Posting"
        triggerLabel="Report posting"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Report posting" }));
    fireEvent.change(
      screen.getByPlaceholderText("Short summary of the issue"),
      {
        target: { value: "Hi" },
      },
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "Describe the behavior, context, and why it violates the rules.",
      ),
      {
        target: { value: "Too short" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));

    expect(
      await screen.findByText("Title must be between 3 and 120 characters."),
    ).toBeInTheDocument();
    expect(createReportMock).not.toHaveBeenCalled();
  });

  it("submits the report and shows success feedback", async () => {
    render(
      <ReportDialog
        subjectType="posting"
        subjectId="posting-1"
        subjectLabel="Posting"
        triggerLabel="Report posting"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Report posting" }));
    fireEvent.change(
      screen.getByPlaceholderText("Short summary of the issue"),
      {
        target: { value: "Listing looks fraudulent" },
      },
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "Describe the behavior, context, and why it violates the rules.",
      ),
      {
        target: {
          value:
            "The listing asks for payment outside the platform and uses misleading details.",
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));

    await waitFor(() => {
      expect(createReportMock).toHaveBeenCalledWith({
        subjectType: "posting",
        subjectId: "posting-1",
        reasonCode: "spam",
        title: "Listing looks fraudulent",
        description:
          "The listing asks for payment outside the platform and uses misleading details.",
      });
    });

    expect(
      await screen.findByText("Posting was reported for spam."),
    ).toBeInTheDocument();
  });
});
