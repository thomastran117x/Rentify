/** The elements a modal's focus trap cycles through, in document order. */
export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

/**
 * Keeps Tab and Shift+Tab inside `root`. Returns true when it handled the
 * key, so the caller can stop there.
 */
export function trapTabKey(event: KeyboardEvent, root: HTMLElement): boolean {
  if (event.key !== "Tab") {
    return false;
  }

  const focusable = getFocusableElements(root);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (!first || !last) {
    event.preventDefault();
    return true;
  }

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }

  return true;
}
