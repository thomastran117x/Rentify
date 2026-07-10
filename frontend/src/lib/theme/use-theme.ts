import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "rentify-theme";
const listeners = new Set<() => void>();

function canUseDom(): boolean {
  return typeof window !== "undefined";
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** Reads the active theme from the `dark` class on <html> (the source of truth). */
export function getTheme(): Theme {
  if (!canUseDom()) {
    return "light";
  }

  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  if (!canUseDom()) {
    return;
  }

  document.documentElement.classList.toggle("dark", theme === "dark");

  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures (private mode, quota, disabled).
  }

  notify();
}

export function toggleTheme(): void {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Subscribes to the current theme. All toggle buttons share one store, so they
 * stay in sync. The server snapshot is always "light" to keep SSR/hydration
 * stable; the real value is read on the client after hydration.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(
    subscribe,
    getTheme,
    () => "light" as Theme,
  );

  return { theme, toggle: toggleTheme };
}
