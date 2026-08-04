"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, ReactNode, useId, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import type { Pagination as PaginationMeta } from "@/lib/api/types";
import { theme } from "@/styles/theme";
import { PAGE_SIZE_TEMPLATE_TOKEN, PAGE_TEMPLATE_TOKEN } from "./href-template";
import { getPageRange } from "./page-range";

interface PaginationBaseProps {
  /** The `pagination` block returned by the API. */
  pagination: PaginationMeta;
  /** Noun used in the range summary. Defaults to item/items. */
  itemLabel?: { one: string; other: string };
  /** Render the "Showing 41-60 of 834" summary. Defaults to true. */
  showSummary?: boolean;
  /** Render the "Go to page" input. Defaults to false. */
  showGoToPage?: boolean;
  /** Page sizes offered in the selector. Omit to hide the selector. */
  pageSizeOptions?: readonly number[];
  /** Pages shown either side of the current page. Defaults to 1. */
  siblingCount?: number;
  /** Disable every control, e.g. while a fetch is in flight. */
  disabled?: boolean;
  /** Wrap in a top border and padding. Set false inside an existing card. */
  bordered?: boolean;
  /** Appended to the outer container class. */
  className?: string;
  /** Label for the <nav>. Defaults to "Pagination". */
  ariaLabel?: string;
}

/** Pagination for call sites that hold the current page in React state. */
export interface PaginationProps extends PaginationBaseProps {
  onPageChange: (page: number) => void;
  /**
   * Required whenever `pageSizeOptions` is passed. The handler MUST also reset
   * the page to 1 — this component does not call `onPageChange` for it, so that
   * call sites holding page and page size in one state object can update both
   * in a single render.
   */
  onPageSizeChange?: (pageSize: number) => void;
}

/** Pagination for call sites that hold the current page in the URL. */
export interface PaginationLinksProps extends PaginationBaseProps {
  /**
   * Absolute href containing {@link PAGE_TEMPLATE_TOKEN}, e.g.
   * `/postings?sort=newest&page=__RENTIFY_PAGE__&pageSize=20`.
   */
  pageHrefTemplate: string;
  /**
   * Href containing {@link PAGE_SIZE_TEMPLATE_TOKEN}. Callers must build it with
   * `page: 1` so changing the page size returns to the first page.
   */
  pageSizeHrefTemplate?: string;
  /** Forwarded to `<Link scroll>`. Defaults to true. */
  scroll?: boolean;
}

interface PageRenderOptions {
  current?: boolean;
  disabled?: boolean;
  icon?: "first" | "previous" | "next" | "last";
}

interface PaginationShellProps extends PaginationBaseProps {
  renderPage: (
    page: number,
    label: string,
    options: PageRenderOptions,
  ) => ReactNode;
  renderPageSize: (options: readonly number[]) => ReactNode;
  onGoToPage: (page: number) => void;
}

const ICONS = {
  first: ChevronsLeft,
  previous: ChevronLeft,
  next: ChevronRight,
  last: ChevronsRight,
} as const;

function PageIcon({ icon }: { icon: NonNullable<PageRenderOptions["icon"]> }) {
  const Icon = ICONS[icon];
  return <Icon className="h-4 w-4" aria-hidden="true" />;
}

function PaginationShell({
  pagination,
  itemLabel = { one: "item", other: "items" },
  showSummary = true,
  showGoToPage = false,
  pageSizeOptions,
  siblingCount = 1,
  disabled = false,
  bordered = true,
  className = "",
  ariaLabel = "Pagination",
  renderPage,
  renderPageSize,
  onGoToPage,
}: PaginationShellProps) {
  const inputId = useId();
  const [goToValue, setGoToValue] = useState("");

  const { page, pageSize, total, totalPages, hasNextPage, hasPreviousPage } =
    pagination;
  const lastPage = Math.max(totalPages, 1);
  const items = getPageRange(page, lastPage, siblingCount);
  const rangeStart = (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  if (total === 0) {
    return null;
  }

  function handleGoToSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = Number.parseInt(goToValue, 10);
    setGoToValue("");

    if (!Number.isFinite(parsed)) {
      return;
    }

    const target = Math.min(Math.max(parsed, 1), lastPage);

    if (target !== page) {
      onGoToPage(target);
    }
  }

  const containerClass = [
    bordered ? theme.pagination.container : theme.pagination.containerBare,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClass}>
      {showSummary ? (
        <p className={theme.pagination.summary} aria-live="polite">
          Showing {rangeStart}-{rangeEnd} of {total}{" "}
          {total === 1 ? itemLabel.one : itemLabel.other}
        </p>
      ) : (
        <span />
      )}

      {lastPage > 1 ? (
        <nav aria-label={ariaLabel} className={theme.pagination.nav}>
          <ul className={theme.pagination.list}>
            <li>
              {renderPage(1, "First page", {
                icon: "first",
                disabled: disabled || !hasPreviousPage,
              })}
            </li>
            <li>
              {renderPage(page - 1, "Previous page", {
                icon: "previous",
                disabled: disabled || !hasPreviousPage,
              })}
            </li>

            {items.map((item, index) =>
              item === "ellipsis" ? (
                <li
                  key={`ellipsis-${index}`}
                  className={theme.pagination.numbersOnly}
                >
                  <span
                    className={theme.pagination.ellipsis}
                    aria-hidden="true"
                  >
                    &hellip;
                  </span>
                </li>
              ) : (
                <li key={item} className={theme.pagination.numbersOnly}>
                  {renderPage(item, `Page ${item}`, {
                    current: item === page,
                    disabled,
                  })}
                </li>
              ),
            )}

            <li>
              {renderPage(page + 1, "Next page", {
                icon: "next",
                disabled: disabled || !hasNextPage,
              })}
            </li>
            <li>
              {renderPage(lastPage, "Last page", {
                icon: "last",
                disabled: disabled || !hasNextPage,
              })}
            </li>
          </ul>

          <p className={theme.pagination.compactStatus}>
            Page {page} of {lastPage}
          </p>
        </nav>
      ) : null}

      <div className={theme.pagination.extras}>
        {pageSizeOptions && pageSizeOptions.length > 0
          ? renderPageSize(pageSizeOptions)
          : null}

        {showGoToPage && lastPage > 1 ? (
          // noValidate: min/max below describe the range to the user and bound
          // the spinner, but native validation would reject an out-of-range
          // entry outright. Clamping in handleGoToSubmit is friendlier.
          <form
            className={theme.pagination.jumpForm}
            noValidate
            onSubmit={handleGoToSubmit}
          >
            <label htmlFor={inputId} className={theme.pagination.jumpLabel}>
              Go to page
            </label>
            <input
              id={inputId}
              type="number"
              inputMode="numeric"
              min={1}
              max={lastPage}
              value={goToValue}
              disabled={disabled}
              placeholder={String(page)}
              onChange={(event) => setGoToValue(event.target.value)}
              className={theme.pagination.jumpInput}
            />
            <button
              type="submit"
              disabled={disabled}
              className={theme.pagination.jumpButton}
            >
              Go
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export function Pagination({
  onPageChange,
  onPageSizeChange,
  ...rest
}: PaginationProps) {
  const sizeLabelId = useId();

  return (
    <PaginationShell
      {...rest}
      onGoToPage={onPageChange}
      renderPage={(targetPage, label, options) => {
        const isCurrent = options.current === true;

        return (
          <button
            type="button"
            disabled={options.disabled === true}
            aria-label={options.icon ? label : undefined}
            aria-current={isCurrent ? "page" : undefined}
            onClick={() => onPageChange(targetPage)}
            className={pageClassName(options)}
          >
            {options.icon ? <PageIcon icon={options.icon} /> : targetPage}
          </button>
        );
      }}
      renderPageSize={(options) => (
        <div className={theme.pagination.jumpForm}>
          <label htmlFor={sizeLabelId} className={theme.pagination.sizeLabel}>
            Per page
          </label>
          <select
            id={sizeLabelId}
            value={rest.pagination.pageSize}
            disabled={rest.disabled === true}
            onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
            className={theme.pagination.sizeSelect}
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      )}
    />
  );
}

export function PaginationLinks({
  pageHrefTemplate,
  pageSizeHrefTemplate,
  scroll = true,
  ...rest
}: PaginationLinksProps) {
  // Deliberately no useSearchParams here: this component renders inside the
  // /postings server component, and useSearchParams would opt that route into
  // client-side rendering. Everything URL-shaped arrives as a prop.
  const router = useRouter();
  const sizeLabelId = useId();

  function hrefForPage(targetPage: number): string {
    return pageHrefTemplate.replaceAll(PAGE_TEMPLATE_TOKEN, String(targetPage));
  }

  return (
    <PaginationShell
      {...rest}
      onGoToPage={(targetPage) =>
        router.push(hrefForPage(targetPage), { scroll })
      }
      renderPage={(targetPage, label, options) => {
        const content = options.icon ? (
          <PageIcon icon={options.icon} />
        ) : (
          targetPage
        );

        if (options.disabled === true) {
          // A span rather than a disabled link: not focusable, and not
          // announced as a link that goes nowhere.
          return (
            <span
              aria-disabled="true"
              aria-label={options.icon ? label : undefined}
              className={pageClassName(options)}
            >
              {content}
            </span>
          );
        }

        const isCurrent = options.current === true;

        return (
          <Link
            href={hrefForPage(targetPage)}
            scroll={scroll}
            // Prefetching every numbered link would fan out to ~9 requests for
            // a dynamic route; only prev/next are likely enough to be worth it.
            prefetch={
              options.icon === "previous" || options.icon === "next"
                ? undefined
                : false
            }
            aria-label={options.icon ? label : undefined}
            aria-current={isCurrent ? "page" : undefined}
            className={pageClassName(options)}
          >
            {content}
          </Link>
        );
      }}
      renderPageSize={(options) => (
        <div className={theme.pagination.jumpForm}>
          <label htmlFor={sizeLabelId} className={theme.pagination.sizeLabel}>
            Per page
          </label>
          <select
            id={sizeLabelId}
            value={rest.pagination.pageSize}
            disabled={rest.disabled === true || !pageSizeHrefTemplate}
            onChange={(event) => {
              if (!pageSizeHrefTemplate) {
                return;
              }
              router.push(
                pageSizeHrefTemplate.replaceAll(
                  PAGE_SIZE_TEMPLATE_TOKEN,
                  event.target.value,
                ),
                { scroll },
              );
            }}
            className={theme.pagination.sizeSelect}
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      )}
    />
  );
}

function pageClassName(options: PageRenderOptions): string {
  if (options.disabled === true) {
    return options.icon
      ? theme.pagination.iconButtonDisabled
      : theme.pagination.pageDisabled;
  }
  if (options.icon) {
    return theme.pagination.iconButton;
  }
  return options.current === true
    ? theme.pagination.pageActive
    : theme.pagination.page;
}
