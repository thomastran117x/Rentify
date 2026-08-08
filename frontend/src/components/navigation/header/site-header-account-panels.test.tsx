import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SiteHeaderDesktopAccount, SiteHeaderMobileAccountSection } from "./site-header-account-panels";

vi.mock("./site-header.shared", () => ({
  UserAvatar: ({ name, imageUrl }: { name: string; imageUrl?: string | null }) => <span>{name}:{imageUrl ?? "none"}</span>,
}));

const session = {
  accessToken: "token",
  device: { known: true, knownByIp: false },
  user: { id: "user-1", email: "person@example.com", username: "person", role: "user" as const, avatarUrl: "avatar.png" },
};
const links = [{ href: "/account", label: "Account settings", description: "Manage account" }];

describe("site header account panels", () => {
  it("renders desktop loading, anonymous, and login-route states", () => {
    const onLogout = vi.fn(async () => undefined);
    const { rerender } = render(<SiteHeaderDesktopAccount pathname="/" status="loading" session={null} displayName="Account" accountLinks={[]} logoutPending={false} onLogout={onLogout} />);
    expect(document.querySelector("[aria-hidden='true']")).toBeInTheDocument();
    rerender(<SiteHeaderDesktopAccount pathname="/" status="anonymous" session={null} displayName="Account" accountLinks={[]} logoutPending={false} onLogout={onLogout} />);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    rerender(<SiteHeaderDesktopAccount pathname="/login" status="anonymous" session={null} displayName="Account" accountLinks={[]} logoutPending={false} onLogout={onLogout} />);
    expect(screen.queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
  });

  it("renders authenticated desktop identity, links, and logout states", () => {
    const onLogout = vi.fn(async () => undefined);
    const { rerender } = render(<SiteHeaderDesktopAccount pathname="/" status="authenticated" session={session as never} displayName="Person" accountLinks={links} logoutPending={false} onLogout={onLogout} />);
    expect(screen.getByLabelText("Person account menu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Account settings/ })).toHaveAttribute("href", "/account");
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalled();
    rerender(<SiteHeaderDesktopAccount pathname="/" status="authenticated" session={session as never} displayName="Person" accountLinks={links} logoutPending onLogout={onLogout} />);
    expect(screen.getByRole("button", { name: "Logging out..." })).toBeDisabled();
  });

  it("renders authenticated mobile identity and hides anonymous content", () => {
    const onLogout = vi.fn(async () => undefined);
    const { rerender } = render(<SiteHeaderMobileAccountSection status="authenticated" session={session as never} displayName="Person" accountLinks={links} logoutPending={false} onLogout={onLogout} />);
    expect(screen.getByText("person:avatar.png")).toBeInTheDocument();
    expect(screen.getByText("person@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalled();
    rerender(<SiteHeaderMobileAccountSection status="anonymous" session={null} displayName="Account" accountLinks={[]} logoutPending={false} onLogout={onLogout} />);
    expect(screen.queryByText("Account settings")).not.toBeInTheDocument();
  });
});
