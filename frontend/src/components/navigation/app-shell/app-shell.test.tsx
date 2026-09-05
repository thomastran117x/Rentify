import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

const { usePathnameMock, useAuthMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(() => "/"),
  useAuthMock: vi.fn(() => ({
    status: "authenticated" as const,
    session: {
      accessToken: "token",
      device: { known: true, knownByIp: false },
      user: {
        id: "user-1",
        email: "person@example.com",
        username: "person",
        role: "user" as const,
      },
    },
  })),
}));

vi.mock("next/navigation", () => ({ usePathname: usePathnameMock }));
vi.mock("@/components/auth/auth-context", () => ({ useAuth: useAuthMock }));

function renderShell() {
  return render(
    <AppShell>
      <main>page content</main>
    </AppShell>,
  );
}

describe("AppShell", () => {
  it("leaves public routes header-only", () => {
    usePathnameMock.mockReturnValue("/postings");
    const { container } = renderShell();

    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(container.querySelector("aside")).not.toBeInTheDocument();
  });

  it("wraps workspace routes with the sidebar", () => {
    usePathnameMock.mockReturnValue("/dashboard");
    const { container } = renderShell();

    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(container.querySelector("aside")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Workspace" }),
    ).toBeInTheDocument();
  });

  it("never introduces a second main landmark", () => {
    usePathnameMock.mockReturnValue("/dashboard");
    renderShell();

    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("reserves a skeleton rail while auth is loading", () => {
    usePathnameMock.mockReturnValue("/bookings");
    useAuthMock.mockReturnValueOnce({
      status: "loading",
      session: null,
    } as unknown as ReturnType<typeof useAuthMock>);
    const { container } = renderShell();

    expect(container.querySelector("aside")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("renders no rail for anonymous visitors mid-redirect", () => {
    usePathnameMock.mockReturnValue("/bookings");
    useAuthMock.mockReturnValueOnce({
      status: "anonymous",
      session: null,
    } as unknown as ReturnType<typeof useAuthMock>);
    const { container } = renderShell();

    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(container.querySelector("aside")).not.toBeInTheDocument();
  });
});
