import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./site-header";
const { authMock, logoutMock, pushMock, clearMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  logoutMock: vi.fn(),
  pushMock: vi.fn(),
  clearMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/postings",
  useRouter: () => ({ push: pushMock }),
}));
vi.mock("@/components/auth/auth-context", () => ({ useAuth: authMock }));
vi.mock("@/lib/auth/api", () => ({ authApi: { logout: logoutMock } }));
vi.mock("@/lib/auth/roles", () => ({
  isOwnerRole: () => false,
  canManageOrganizationPostings: () => false,
}));
vi.mock("@/components/navigation/theme-toggle", () => ({
  ThemeToggle: () => <div>Theme</div>,
}));
vi.mock("./site-header-navigation", () => ({
  SiteHeaderDesktopNav: () => <div>Nav</div>,
}));
vi.mock("./site-header-account-panels", () => ({
  SiteHeaderDesktopAccount: ({
    onLogout,
  }: {
    onLogout: () => Promise<void>;
  }) => <button onClick={() => void onLogout()}>Log out</button>,
}));
vi.mock("./site-header-mobile-menu", () => ({
  SiteHeaderMobileMenu: ({ mobileCtaLabel }: { mobileCtaLabel: string }) => (
    <div>{mobileCtaLabel}</div>
  ),
}));
vi.mock("./site-header-search-form", () => ({
  SiteHeaderSearchForm: ({
    query,
    onQueryChange,
    onSubmit,
    variant,
  }: {
    query: string;
    onQueryChange: (v: string) => void;
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    variant: string;
  }) => (
    <form aria-label={`${variant} search`} onSubmit={onSubmit}>
      <input value={query} onChange={(e) => onQueryChange(e.target.value)} />
      <button>Search</button>
    </form>
  ),
}));
vi.mock("./site-header.shared", () => ({
  accountMenuLinks: [],
  getDisplayLabel: () => "Person",
  SearchIcon: () => <span />,
  CloseIcon: () => <span />,
  SiteHeaderLogo: () => <span>Logo</span>,
}));
describe("SiteHeader", () => {
  afterEach(() => vi.clearAllMocks());
  it("submits trimmed desktop and mobile searches", () => {
    authMock.mockReturnValue({
      status: "anonymous",
      session: null,
      clearSession: clearMock,
    });
    render(<SiteHeader />);
    const desktop = screen.getByRole("form", { name: "desktop search" });
    fireEvent.change(desktop.querySelector("input")!, {
      target: { value: " camera " },
    });
    fireEvent.submit(desktop);
    expect(pushMock).toHaveBeenCalledWith("/postings?q=camera");
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    expect(
      screen.getByRole("form", { name: "mobile search" }),
    ).toBeInTheDocument();
  });
  it("uses browse fallback and clears the session after logout", async () => {
    authMock.mockReturnValue({
      status: "authenticated",
      session: {
        user: {
          email: "person@example.com",
          role: "user",
          organizationMembershipCount: 0,
        },
      },
      clearSession: clearMock,
    });
    logoutMock.mockResolvedValue(undefined);
    render(<SiteHeader />);
    fireEvent.submit(screen.getByRole("form", { name: "desktop search" }));
    expect(pushMock).toHaveBeenCalledWith("/postings");
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(clearMock).toHaveBeenCalled());
    expect(pushMock).toHaveBeenCalledWith("/login");
  });
});
