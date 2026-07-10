"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme/use-theme";
import { theme } from "@/styles/theme";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme: current, toggle } = useTheme();
  const isDark = current === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      className={`${theme.header.iconButton}${className ? ` ${className}` : ""}`}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
