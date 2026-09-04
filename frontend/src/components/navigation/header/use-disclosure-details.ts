"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Wires the ergonomics a native `<details>` disclosure does not provide on its
 * own: a mirrored `aria-expanded`, Escape to close, click-outside to close, and
 * closing on client-side navigation (without which clicking a menu link leaves
 * the panel hanging open over the next page).
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

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, close]);

  return { ref, open, onToggle };
}
