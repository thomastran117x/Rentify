"use client";

import { useId, useState } from "react";
import { Star } from "lucide-react";

interface StarRatingProps {
  value: number;
  max?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<StarRatingProps["size"]>, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

/**
 * Read-only star rating display. Supports fractional averages by clipping a
 * filled overlay to the fractional width of the final star.
 */
export function StarRating({
  value,
  max = 5,
  size = "md",
  className,
}: StarRatingProps) {
  const sizeClass = SIZE_CLASS[size];
  const clamped = Math.max(0, Math.min(max, value));

  return (
    <div
      className={`inline-flex items-center gap-0.5 ${className ?? ""}`}
      role="img"
      aria-label={`Rated ${clamped.toFixed(1)} out of ${max}`}
    >
      {Array.from({ length: max }).map((_, index) => {
        const fill = Math.max(0, Math.min(1, clamped - index));

        return (
          <span key={index} className="relative inline-flex">
            <Star
              className={`${sizeClass} text-slate-300 dark:text-slate-600`}
              aria-hidden="true"
            />
            {fill > 0 ? (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fill * 100}%` }}
                aria-hidden="true"
              >
                <Star
                  className={`${sizeClass} fill-amber-400 text-amber-400`}
                />
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

interface StarRatingInputProps {
  value: number;
  onChange: (value: number) => void;
  max?: number;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Interactive, keyboard-accessible star rating input rendered as a radio group.
 */
export function StarRatingInput({
  value,
  onChange,
  max = 5,
  disabled = false,
  size = "lg",
  className,
}: StarRatingInputProps) {
  const groupId = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const sizeClass = SIZE_CLASS[size];
  const active = hovered ?? value;

  return (
    <div
      className={`inline-flex items-center gap-1 ${className ?? ""}`}
      role="radiogroup"
      aria-label="Star rating"
      onMouseLeave={() => setHovered(null)}
    >
      {Array.from({ length: max }).map((_, index) => {
        const starValue = index + 1;
        const isActive = starValue <= active;

        return (
          <button
            key={starValue}
            type="button"
            id={`${groupId}-${starValue}`}
            role="radio"
            aria-checked={value === starValue}
            aria-label={`${starValue} star${starValue === 1 ? "" : "s"}`}
            disabled={disabled}
            className="rounded-full p-0.5 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
            onMouseEnter={() => setHovered(starValue)}
            onFocus={() => setHovered(starValue)}
            onBlur={() => setHovered(null)}
            onClick={() => onChange(starValue)}
          >
            <Star
              className={`${sizeClass} transition ${
                isActive
                  ? "fill-amber-400 text-amber-400"
                  : "text-slate-300 dark:text-slate-600"
              }`}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}
