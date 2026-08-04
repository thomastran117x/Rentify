import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicOrganizationListResult } from "@/lib/organizations/api";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";
import { OrganizationDirectoryPage } from "./organization-directory-page";

const { listPublicMock, searchParamsRef } = vi.hoisted(() => ({
  listPublicMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
  }),
  usePathname: () => "/organizations",
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/organizations/api", () => ({
  organizationsApi: {
    listPublic: listPublicMock,
  },
}));

function result(
  overrides: Partial<PublicOrganizationListResult["pagination"]> = {},
): PublicOrganizationListResult {
  const pageSize = overrides.pageSize ?? 20;
  const total = overrides.total ?? 120;
  const page = overrides.page ?? 1;
  const totalPages = overrides.totalPages ?? Math.ceil(total / pageSize);

  return {
    organizations: [
      {
        id: "org-1",
        name: "Northwind Rentals",
        slug: "northwind-rentals",
        createdAt: "2026-01-15T00:00:00.000Z",
        updatedAt: "2026-01-15T00:00:00.000Z",
      },
    ] as PublicOrganizationListResult["organizations"],
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      ...overrides,
    },
  };
}

function renderWith(search: string) {
  searchParamsRef.current = new URLSearchParams(search);
  return render(<OrganizationDirectoryPage />);
}

beforeEach(() => {
  resetRouterMocks();
  listPublicMock.mockReset();
  listPublicMock.mockResolvedValue(result());
});

describe("OrganizationDirectoryPage pagination", () => {
  it("requests the default page size when the URL omits one", async () => {
    renderWith("");

    await waitFor(() => {
      expect(listPublicMock).toHaveBeenCalledWith({
        page: 1,
        pageSize: 20,
        query: undefined,
      });
    });
  });

  it("honours a supported page size from the URL", async () => {
    listPublicMock.mockResolvedValue(result({ pageSize: 50 }));
    renderWith("?pageSize=50");

    await waitFor(() => {
      expect(listPublicMock).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        query: undefined,
      });
    });
  });

  it("clamps an unsupported page size back to the default", async () => {
    renderWith("?pageSize=999");

    await waitFor(() => {
      expect(listPublicMock).toHaveBeenCalledWith({
        page: 1,
        pageSize: 20,
        query: undefined,
      });
    });
  });

  it("keeps the search term in the URL when paging forward", async () => {
    renderWith("?q=north");

    await screen.findByRole("navigation", {
      name: "Organization directory pagination",
    });

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(routerReplaceMock).toHaveBeenCalledWith(
      "/organizations?q=north&page=2",
      {
        scroll: false,
      },
    );
  });

  it("returns to the first page and records the size when it changes", async () => {
    renderWith("?page=3");

    await screen.findByRole("combobox", { name: "Per page" });

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Per page" }),
      "50",
    );

    expect(routerReplaceMock).toHaveBeenCalledWith(
      "/organizations?pageSize=50",
      {
        scroll: false,
      },
    );
  });

  it("drops the page size param at the default so the URL stays clean", async () => {
    listPublicMock.mockResolvedValue(result({ pageSize: 50, page: 1 }));
    renderWith("?pageSize=50");

    await screen.findByRole("combobox", { name: "Per page" });

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Per page" }),
      "20",
    );

    expect(routerReplaceMock).toHaveBeenCalledWith("/organizations", {
      scroll: false,
    });
  });
});
