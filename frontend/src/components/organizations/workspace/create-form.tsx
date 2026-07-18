"use client";

import { useState } from "react";
import {
  inputClass,
  primaryButtonClass,
} from "@/components/organizations/shared/styles";
import { OrganizationProfileFieldset } from "@/components/organizations/workspace/profile-fieldset";
import type { ProfileFormValue } from "@/components/organizations/workspace/forms";

interface OrganizationCreateFormProps {
  name: string;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  saving: boolean;
  submitLabel: string;
  placeholder?: string;
  profile: ProfileFormValue;
  onProfileChange: (next: ProfileFormValue) => void;
  onProfileError: (message: string) => void;
}

export function OrganizationCreateForm({
  name,
  onNameChange,
  onSubmit,
  saving,
  submitLabel,
  placeholder = "Acme Rentals",
  profile,
  onProfileChange,
  onProfileError,
}: OrganizationCreateFormProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="grid gap-4"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={placeholder}
          aria-label="Organization name"
          maxLength={160}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={saving || name.trim().length === 0}
          className={primaryButtonClass}
        >
          {saving ? "Creating..." : submitLabel}
        </button>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowDetails((current) => !current)}
          className="text-sm font-semibold text-sky-700 transition hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200"
        >
          {showDetails ? "Hide details" : "Add details (optional)"}
        </button>
      </div>

      {showDetails ? (
        <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-800 dark:bg-slate-950/30">
          <OrganizationProfileFieldset
            value={profile}
            onChange={onProfileChange}
            onError={onProfileError}
            disabled={saving}
          />
        </div>
      ) : null}
    </form>
  );
}
