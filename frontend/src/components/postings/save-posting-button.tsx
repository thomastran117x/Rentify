"use client";

import type { MouseEvent } from "react";
import { Heart } from "lucide-react";
import { useSavedPostings } from "@/components/postings/saved-postings-context";
import { theme } from "@/styles/theme";

interface SavePostingButtonProps {
  postingId: string;
  /** Used to build an accessible name that identifies which card was hearted. */
  postingName: string;
  /** "icon" suits result cards; "labelled" suits the detail page header. */
  variant?: "icon" | "labelled";
  className?: string;
}

function resolveClassName(
  variant: "icon" | "labelled",
  saved: boolean,
  disabled: boolean,
): string {
  if (variant === "labelled") {
    if (disabled) {
      return theme.marketplace.saveButtonLabelledDisabled;
    }

    return saved
      ? theme.marketplace.saveButtonLabelledActive
      : theme.marketplace.saveButtonLabelled;
  }

  if (disabled) {
    return theme.marketplace.saveButtonDisabled;
  }

  return saved
    ? theme.marketplace.saveButtonActive
    : theme.marketplace.saveButton;
}

export function SavePostingButton({
  postingId,
  postingName,
  variant = "icon",
  className,
}: SavePostingButtonProps) {
  const { isSaved, isPending, toggleSaved } = useSavedPostings();
  const saved = isSaved(postingId);
  const pending = isPending(postingId);
  const label = saved
    ? `Remove ${postingName} from saved postings`
    : `Save ${postingName}`;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // The card body is a link target; keep the heart from navigating with it.
    event.preventDefault();
    event.stopPropagation();
    void toggleSaved(postingId);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-pressed={saved}
      aria-label={label}
      title={label}
      className={`${resolveClassName(variant, saved, pending)}${
        className ? ` ${className}` : ""
      }`}
    >
      <Heart
        className="h-4 w-4"
        fill={saved ? "currentColor" : "none"}
        aria-hidden="true"
      />
      {variant === "labelled" ? <span>{saved ? "Saved" : "Save"}</span> : null}
    </button>
  );
}
