import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

vi.mock("@/components/auth/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
  usePathname: () => "/admin/security",
}));

const { AdminGuard } = await import("@/components/admin/admin-guard");

function signedInAs(role: string) {
  return {
    status: "authenticated",
    session: { user: { role, email: "x@example.com", username: "x" } },
  };
}

function renderGuard() {
  return render(
    <AdminGuard>
      <p>Admin content</p>
    </AdminGuard>,
  );
}

describe("AdminGuard", () => {
  beforeEach(() => {
    resetRouterMocks();
    useAuthMock.mockReset();
  });

  it("renders the page for an admin", () => {
    useAuthMock.mockReturnValue(signedInAs("admin"));

    renderGuard();

    expect(screen.getByText("Admin content")).toBeInTheDocument();
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it("waits while the session is restored", () => {
    useAuthMock.mockReturnValue({ status: "loading", session: null });

    renderGuard();

    expect(screen.getByRole("status")).toHaveTextContent("Checking access");
    expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to sign in and back", () => {
    useAuthMock.mockReturnValue({ status: "anonymous", session: null });

    renderGuard();

    expect(routerReplaceMock).toHaveBeenCalledWith(
      "/login?next=%2Fadmin%2Fsecurity",
    );
    expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
  });

  it.each(["user", "owner", "moderator"])(
    "sends a %s home without rendering the page",
    (role) => {
      useAuthMock.mockReturnValue(signedInAs(role));

      renderGuard();

      expect(routerReplaceMock).toHaveBeenCalledWith("/");
      expect(screen.getByRole("status")).toHaveTextContent("Redirecting");
      expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
    },
  );
});
