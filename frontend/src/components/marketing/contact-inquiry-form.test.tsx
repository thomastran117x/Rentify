import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContactInquiryForm } from "./contact-inquiry-form";
import { ApiClientError } from "@/lib/api/types";

const { createFeedbackMock, useAuthMock } = vi.hoisted(() => ({
  createFeedbackMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/feedback/api", () => ({
  feedbackApi: {
    create: createFeedbackMock,
  },
}));

vi.mock("@/components/auth/auth-captcha-panel", () => ({
  AuthCaptchaPanel: ({
    token,
    error,
    onChange,
    onReset,
  }: {
    token: string;
    error?: string;
    onChange: (token: string) => void;
    onReset: () => void;
  }) => (
    <div>
      <p>Captcha panel</p>
      <p>{token ? `Captcha token: ${token}` : "Captcha missing"}</p>
      <button type="button" onClick={() => onChange("captcha-token")}>
        Complete captcha
      </button>
      <button type="button" onClick={onReset}>
        Reset captcha
      </button>
      {error ? <p>{error}</p> : null}
    </div>
  ),
}));

describe("ContactInquiryForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      status: "anonymous",
      session: null,
    });
    createFeedbackMock.mockResolvedValue({
      id: "feedback-1",
      category: "feature_request",
      createdAt: "2026-06-15T12:00:00.000Z",
    });
  });

  it("shows validation errors for required fields", () => {
    render(<ContactInquiryForm />);

    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    expect(screen.getByText("Please enter your name.")).toBeInTheDocument();
    expect(
      screen.getByText("Please enter your email address."),
    ).toBeInTheDocument();
    expect(screen.getByText("Please share your feedback.")).toBeInTheDocument();
    expect(
      screen.getByText("Complete the verification before sending feedback."),
    ).toBeInTheDocument();
  });

  it("validates email format and clears errors as fields change", () => {
    render(<ContactInquiryForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    expect(
      screen.getByText("Please use a valid email address."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "valid@example.com" },
    });

    expect(
      screen.queryByText("Please use a valid email address."),
    ).not.toBeInTheDocument();
  });

  it("submits anonymous feedback with captcha and shows confirmation", async () => {
    render(<ContactInquiryForm />);

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "jane@example.com" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Feedback type" }), {
      target: { value: "feature_request" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "What should the team know?" }),
      {
        target: { value: "We need saved searches in the renter workflow." },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete captcha" }));
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    expect(
      screen.getByRole("button", { name: "Sending feedback..." }),
    ).toBeDisabled();

    await waitFor(() => {
      expect(createFeedbackMock).toHaveBeenCalledWith({
        name: "Jane Doe",
        email: "jane@example.com",
        category: "feature_request",
        message: "We need saved searches in the renter workflow.",
        captchaToken: "captcha-token",
      });
    });

    expect(
      await screen.findByText(
        "Thanks. Your feature request has been sent to the Rentify team.",
      ),
    ).toBeInTheDocument();
  });

  it("prefills authenticated users and skips captcha", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: {
        user: {
          email: "member@example.com",
          username: "member-one",
        },
      },
    });

    render(<ContactInquiryForm />);

    expect(screen.getByDisplayValue("member-one")).toBeInTheDocument();
    expect(screen.getByDisplayValue("member@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Captcha panel")).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("textbox", { name: "What should the team know?" }),
      {
        target: { value: "Search filters should stay applied after refresh." },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    await waitFor(() => {
      expect(createFeedbackMock).toHaveBeenCalledWith({
        name: "member-one",
        email: "member@example.com",
        category: "bug_report",
        message: "Search filters should stay applied after refresh.",
      });
    });
  });

  it("surfaces backend failures and clears captcha when verification fails", async () => {
    createFeedbackMock.mockRejectedValue(
      new ApiClientError("Captcha verification failed.", {
        code: "BAD_REQUEST",
        request: {
          method: "POST",
          path: "/feedback",
          requestUrl: "http://localhost:8040/api/v1/feedback",
        },
        status: 400,
      }),
    );

    render(<ContactInquiryForm />);

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "jane@example.com" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "What should the team know?" }),
      {
        target: { value: "The contact page crashes after login redirect." },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete captcha" }));
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    expect(
      await screen.findByText("Please complete the verification again."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Captcha verification failed."),
    ).toBeInTheDocument();
    expect(screen.getByText("Captcha missing")).toBeInTheDocument();
  });
});
