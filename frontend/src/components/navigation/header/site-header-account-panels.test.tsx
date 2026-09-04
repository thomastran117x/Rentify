import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SiteHeaderDesktopAccount } from "./site-header-account-panels";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

vi.mock("@/components/navigation/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Toggle theme</button>,
}));

vi.mock("./site-header.shared", async () => {
  const actual =
    await vi.importActual<typeof import("./site-header.shared")>(
      "./site-header.shared",
    );

  return {
    ...actual,
    UserAvatar: ({
      name,
      imageUrl,
    }: {
      name: string;
      imageUrl?: string | null;
    }) => (
      <span>
        {name}:{imageUrl ?? "none"}
      </span>
    ),
  };
});

const session = {
  accessToken: "token",
  device: { known: true, knownByIp: false },
  user: {
    id: "user-1",
    email: "person@example.com",
    username: "person",
    role: "user" as const,
    avatarUrl: "avatar.png",
  },
};

function renderAccount(
  props: Partial<React.ComponentProps<typeof SiteHeaderDesktopAccount>> = {},
) {
  const onLogout = props.onLogout ?? vi.fn(async () => undefined);

  const result = render(
    <SiteHeaderDesktopAccount
      pathname="/"
      status="authenticated"
      session={session as never}
      displayName="Person"
      logoutPending={false}
      onLogout={onLogout}
      {...props}
    />,
  );

  return { ...result, onLogout };
}

describe("site header account panels", () => {
  it("renders desktop loading, anonymous, and login-route states", () => {
    const onLogout = vi.fn(async () => undefined);
    const { rerender } = render(
      <SiteHeaderDesktopAccount
        pathname="/"
        status="loading"
        session={null}
        displayName="Account"
        logoutPending={false}
        onLogout={onLogout}
      />,
    );
    expect(document.querySelector("[aria-hidden='true']")).toBeInTheDocument();

    rerender(
      <SiteHeaderDesktopAccount
        pathname="/"
        status="anonymous"
        session={null}
        displayName="Account"
        logoutPending={false}
        onLogout={onLogout}
      />,
    );
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );

    rerender(
      <SiteHeaderDesktopAccount
        pathname="/login"
        status="anonymous"
        session={null}
        displayName="Account"
        logoutPending={false}
        onLogout={onLogout}
      />,
    );
    expect(
      screen.queryByRole("link", { name: "Log in" }),
    ).not.toBeInTheDocument();
  });

  it("renders identity, the two account links, theme, and logout", () => {
    const { onLogout } = renderAccount();

    expect(screen.getByLabelText("Person account menu")).toBeInTheDocument();
    expect(screen.getByText("person@example.com")).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: "Manage account" }),
    ).toHaveAttribute("href", "/account");
    expect(screen.getByRole("link", { name: "Organizations" })).toHaveAttribute(
      "href",
      "/dashboard/organizations",
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);

    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Toggle theme" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalled();
  });

  it("carries no workspace navigation", () => {
    renderAccount();

    for (const label of [
      "Dashboard",
      "Postings",
      "Create posting",
      "Moderation",
      "Saved",
      "Bookings",
    ]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });

  it("disables the logout button while a logout is pending", () => {
    renderAccount({ logoutPending: true });

    expect(
      screen.getByRole("button", { name: "Logging out..." }),
    ).toBeDisabled();
  });

  it("mirrors the disclosure state onto aria-expanded", () => {
    renderAccount();

    const trigger = screen.getByLabelText("Person account menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    const disclosure = trigger.closest("details") as HTMLDetailsElement;
    disclosure.open = true;
    fireEvent(disclosure, new Event("toggle"));

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});
