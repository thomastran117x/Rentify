import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContactInquiryForm } from "./contact-inquiry-form";

describe("ContactInquiryForm", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows validation errors for required fields", () => {
    render(<ContactInquiryForm />);

    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    expect(screen.getByText("Please enter your name.")).toBeInTheDocument();
    expect(
      screen.getByText("Please enter your email address."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Please share a few project details."),
    ).toBeInTheDocument();
  });

  it("validates email format and clears errors as fields change", () => {
    render(<ContactInquiryForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

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

  it("submits successfully, disables the button while pending, and shows confirmation", async () => {
    let finishSubmission: (() => void) | undefined;
    const setTimeoutSpy = vi
      .spyOn(window, "setTimeout")
      .mockImplementation((callback) => {
        finishSubmission = callback as () => void;
        return 1 as unknown as ReturnType<typeof window.setTimeout>;
      });

    render(<ContactInquiryForm />);

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "jane@example.com" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Focus area" }), {
      target: { value: "Partnerships" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Project notes" }), {
      target: { value: "We need help sourcing equipment." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));

    expect(
      screen.getByRole("button", { name: "Sending inquiry..." }),
    ).toBeDisabled();

    expect(finishSubmission).toBeTypeOf("function");

    await act(async () => {
      finishSubmission?.();
      await Promise.resolve();
    });

    setTimeoutSpy.mockRestore();

    expect(
      screen.getByText(
        "Thanks. Your inquiry has been captured locally and is ready for backend integration next.",
      ),
    ).toBeInTheDocument();
  });
});
