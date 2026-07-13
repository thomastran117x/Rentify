import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("ForgotPasswordPage", () => {
  it("redirects to login with the recovery modal open", async () => {
    const { default: ForgotPasswordPage } = await import("./page");

    ForgotPasswordPage();

    expect(redirectMock).toHaveBeenCalledWith("/login?recovery=account");
  });
});
