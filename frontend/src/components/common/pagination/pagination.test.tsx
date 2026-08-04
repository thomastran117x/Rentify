import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pagination as PaginationMeta } from "@/lib/api/types";
import { resetRouterMocks, routerPushMock } from "@/test/mocks/next-navigation";
import { PAGE_SIZE_TEMPLATE_TOKEN, PAGE_TEMPLATE_TOKEN } from "./href-template";
import { Pagination, PaginationLinks } from "./pagination";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    prefetch?: boolean;
    scroll?: boolean;
  }) => {
    // Next-only props would otherwise reach the DOM and warn.
    const anchorProps = { ...props };
    delete anchorProps.prefetch;
    delete anchorProps.scroll;

    return (
      <a href={href} {...anchorProps}>
        {children}
      </a>
    );
  },
}));

function meta(overrides: Partial<PaginationMeta> = {}): PaginationMeta {
  const page = overrides.page ?? 1;
  const pageSize = overrides.pageSize ?? 20;
  const total = overrides.total ?? 834;
  const totalPages = overrides.totalPages ?? Math.ceil(total / pageSize);

  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: overrides.hasNextPage ?? page < totalPages,
    hasPreviousPage: overrides.hasPreviousPage ?? page > 1,
    ...overrides,
  };
}

const HREF_TEMPLATE = `/postings?sort=newest&page=${PAGE_TEMPLATE_TOKEN}&pageSize=20`;

beforeEach(() => {
  resetRouterMocks();
});

describe("Pagination (callback mode)", () => {
  it("renders the truncated page window and reports the clicked page", async () => {
    const onPageChange = vi.fn();
    render(
      <Pagination pagination={meta({ page: 7 })} onPageChange={onPageChange} />,
    );

    const nav = screen.getByRole("navigation", { name: "Pagination" });
    const pageButtons = within(nav)
      .getAllByRole("button")
      .map((button) => button.textContent)
      .filter((text) => text && /^\d+$/.test(text));

    expect(pageButtons).toEqual(["1", "6", "7", "8", "42"]);

    await userEvent.click(within(nav).getByRole("button", { name: "8" }));
    expect(onPageChange).toHaveBeenCalledWith(8);
  });

  it("marks only the current page with aria-current", () => {
    render(
      <Pagination pagination={meta({ page: 7 })} onPageChange={vi.fn()} />,
    );

    const current = screen.getAllByRole("button", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("7");
  });

  it("disables the backward controls on the first page", () => {
    render(
      <Pagination pagination={meta({ page: 1 })} onPageChange={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "First page" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Last page" })).toBeEnabled();
  });

  it("disables the forward controls on the last page", () => {
    render(
      <Pagination pagination={meta({ page: 42 })} onPageChange={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Last page" })).toBeDisabled();
  });

  it("renders the range summary for a full page", () => {
    render(
      <Pagination pagination={meta({ page: 3 })} onPageChange={vi.fn()} />,
    );

    expect(screen.getByText("Showing 41-60 of 834 items")).toBeInTheDocument();
  });

  it("clamps the range summary on a partial last page", () => {
    render(
      <Pagination
        pagination={meta({ page: 42, total: 834 })}
        itemLabel={{ one: "posting", other: "postings" }}
        onPageChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Showing 821-834 of 834 postings"),
    ).toBeInTheDocument();
  });

  it("renders nothing when there are no results", () => {
    const { container } = render(
      <Pagination
        pagination={meta({ page: 1, total: 0, totalPages: 0 })}
        onPageChange={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the summary and page size selector on a single page", () => {
    render(
      <Pagination
        pagination={meta({ page: 1, total: 4, pageSize: 20 })}
        pageSizeOptions={[10, 20, 50]}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1-4 of 4 items")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Per page" })).toBeVisible();
  });

  it("omits the optional controls by default", () => {
    render(
      <Pagination pagination={meta({ page: 3 })} onPageChange={vi.fn()} />,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("disables every control when disabled", () => {
    render(
      <Pagination
        pagination={meta({ page: 7 })}
        showGoToPage
        pageSizeOptions={[10, 20, 50]}
        disabled
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
    expect(
      screen.getByRole("spinbutton", { name: "Go to page" }),
    ).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Per page" })).toBeDisabled();
  });

  it("reports the selected page size", async () => {
    const onPageSizeChange = vi.fn();
    render(
      <Pagination
        pagination={meta({ page: 7 })}
        pageSizeOptions={[10, 20, 50]}
        onPageChange={vi.fn()}
        onPageSizeChange={onPageSizeChange}
      />,
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Per page" }),
      "50",
    );

    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});

describe("Pagination ellipsis", () => {
  it.each<[string, number, number, number]>([
    ["both sides in the middle", 7, 42, 2],
    ["one side on the first page", 1, 42, 1],
    ["neither side on a short list", 3, 5, 0],
  ])("renders %s", (_label, page, totalPages, expected) => {
    const { container } = render(
      <Pagination
        pagination={meta({ page, totalPages, total: totalPages * 20 })}
        onPageChange={vi.fn()}
      />,
    );

    expect(
      container.querySelectorAll('[aria-hidden="true"] + *'),
    ).toBeDefined();
    const ellipses = Array.from(container.querySelectorAll("span")).filter(
      (node) => node.textContent === "…",
    );
    expect(ellipses).toHaveLength(expected);
  });
});

describe("Pagination go to page", () => {
  it("clamps a page above the last page", async () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        pagination={meta({ page: 7 })}
        showGoToPage
        onPageChange={onPageChange}
      />,
    );

    await userEvent.type(
      screen.getByRole("spinbutton", { name: "Go to page" }),
      "999{Enter}",
    );

    expect(onPageChange).toHaveBeenCalledWith(42);
  });

  it("clamps a page below the first page", async () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        pagination={meta({ page: 7 })}
        showGoToPage
        onPageChange={onPageChange}
      />,
    );

    await userEvent.type(
      screen.getByRole("spinbutton", { name: "Go to page" }),
      "0{Enter}",
    );

    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("submits from the Go button", async () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        pagination={meta({ page: 7 })}
        showGoToPage
        onPageChange={onPageChange}
      />,
    );

    const input = screen.getByRole("spinbutton", { name: "Go to page" });
    await userEvent.type(input, "12");
    await userEvent.click(screen.getByRole("button", { name: "Go" }));

    expect(onPageChange).toHaveBeenCalledWith(12);
    expect(input).toHaveValue(null);
  });

  it("ignores a non-numeric entry and clears the field", async () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        pagination={meta({ page: 7 })}
        showGoToPage
        onPageChange={onPageChange}
      />,
    );

    const input = screen.getByRole("spinbutton", { name: "Go to page" });
    await userEvent.type(input, "abc");
    await userEvent.click(screen.getByRole("button", { name: "Go" }));

    expect(onPageChange).not.toHaveBeenCalled();
    expect(input).toHaveValue(null);
  });

  it("ignores the current page", async () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        pagination={meta({ page: 7 })}
        showGoToPage
        onPageChange={onPageChange}
      />,
    );

    await userEvent.type(
      screen.getByRole("spinbutton", { name: "Go to page" }),
      "7{Enter}",
    );

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("is hidden when there is only one page", () => {
    render(
      <Pagination
        pagination={meta({ page: 1, total: 4 })}
        showGoToPage
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
});

describe("PaginationLinks (link mode)", () => {
  it("resolves the page token into every href", () => {
    render(
      <PaginationLinks
        pagination={meta({ page: 7 })}
        pageHrefTemplate={HREF_TEMPLATE}
      />,
    );

    expect(screen.getByRole("link", { name: "8" })).toHaveAttribute(
      "href",
      "/postings?sort=newest&page=8&pageSize=20",
    );
    expect(screen.getByRole("link", { name: "Last page" })).toHaveAttribute(
      "href",
      "/postings?sort=newest&page=42&pageSize=20",
    );
    expect(screen.getByRole("link", { name: "First page" })).toHaveAttribute(
      "href",
      "/postings?sort=newest&page=1&pageSize=20",
    );
  });

  it("renders disabled edges as non-focusable spans, not links", () => {
    render(
      <PaginationLinks
        pagination={meta({ page: 1 })}
        pageHrefTemplate={HREF_TEMPLATE}
      />,
    );

    expect(
      screen.queryByRole("link", { name: "Previous page" }),
    ).not.toBeInTheDocument();

    const disabled = screen.getByLabelText("Previous page");
    expect(disabled.tagName).toBe("SPAN");
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    expect(disabled).not.toHaveAttribute("href");
  });

  it("marks the current page link with aria-current", () => {
    render(
      <PaginationLinks
        pagination={meta({ page: 7 })}
        pageHrefTemplate={HREF_TEMPLATE}
      />,
    );

    const current = screen.getAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("7");
  });

  it("navigates on a go to page submit", async () => {
    render(
      <PaginationLinks
        pagination={meta({ page: 7 })}
        showGoToPage
        pageHrefTemplate={HREF_TEMPLATE}
      />,
    );

    await userEvent.type(
      screen.getByRole("spinbutton", { name: "Go to page" }),
      "12{Enter}",
    );

    expect(routerPushMock).toHaveBeenCalledWith(
      "/postings?sort=newest&page=12&pageSize=20",
      { scroll: true },
    );
  });

  it("navigates to a page size href pinned to page 1", async () => {
    render(
      <PaginationLinks
        pagination={meta({ page: 7 })}
        pageSizeOptions={[10, 20, 50]}
        pageHrefTemplate={HREF_TEMPLATE}
        pageSizeHrefTemplate={`/postings?sort=newest&page=1&pageSize=${PAGE_SIZE_TEMPLATE_TOKEN}`}
      />,
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Per page" }),
      "50",
    );

    expect(routerPushMock).toHaveBeenCalledWith(
      "/postings?sort=newest&page=1&pageSize=50",
      { scroll: true },
    );
  });
});
