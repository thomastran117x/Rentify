"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Wires the ergonomics a native `<details>` disclosure does not provide on its
 * own: a mirrored `aria-expanded`, Escape to close, click-outside to close, and
 * closing on navigation (without which clicking a menu link leaves the panel
 * hanging open over the next page).
 *
 * Navigation is caught two ways because neither alone is enough. `usePathname()`
 * misses query-only moves — it reads `/postings` for both `/postings?q=chair`
 * and `/postings`, so the mobile menu's Browse link would clear the filter and
 * leave the panel open — and it is preferred over `useSearchParams()`, which
 * would opt every page out of static rendering from the root layout. So links
 * inside the panel also close it on activation, which additionally covers a
 * click that resolves to the very same URL.
 *
 * The `<details>` element is kept deliberately — it needs no JS to open, works
 * before hydration, and Chromium exposes `<summary>` as `DisclosureTriangle`
 * rather than `button`, which the e2e locators rely on.
 */
export function useDisclosureDetails() {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // The DOM element is the single source of truth for open/closed; `open` state
  // exists only to mirror it onto `aria-expanded`, and is driven by the native
  // `toggle` event, which fires for programmatic changes too.
  const close = useCallback(() => {
    const element = ref.current;

    if (element?.open) {
      element.open = false;
    }
  }, []);

  const onToggle = useCallback(() => {
    setOpen(Boolean(ref.current?.open));
  }, []);

  useEffect(() => {
    close();
    // Closing is keyed to navigation, not to `close` identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
        ref.current?.querySelector("summary")?.focus();
      }
    }

    function handlePointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        close();
      }
    }

    function handleClick(event: MouseEvent) {
      const target = event.target as Element | null;

      if (target?.closest?.("a[href]")) {
        close();
      }
    }

    const element = ref.current;

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    element?.addEventListener("click", handleClick);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      element?.removeEventListener("click", handleClick);
    };
  }, [open, close]);

  return { ref, open, onToggle };
}
