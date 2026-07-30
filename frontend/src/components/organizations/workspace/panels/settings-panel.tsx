"use client";

import { useState } from "react";
import {
  fieldLabelClass,
  inputClass,
  primaryButtonClass,
} from "@/components/organizations/shared/styles";
import { SectionCard } from "@/components/organizations/shared/primitives";
import { OrganizationProfileFieldset } from "@/components/organizations/workspace/profile-fieldset";
import { useOrganizationWorkspace } from "@/components/organizations/workspace/workspace-provider";

function OrganizationUrlField() {
  const {
    detail,
    organizationSlug,
    setOrganizationSlug,
    organizationSlugError,
    savingSlug,
    handleSaveSlug,
    canEditSettings,
  } = useOrganizationWorkspace();
  const [confirming, setConfirming] = useState(false);

  const currentSlug = detail?.organization.slug ?? "";
  const nextSlug = organizationSlug.trim().toLowerCase();
  const changed = nextSlug.length > 0 && nextSlug !== currentSlug;
  const blocked = organizationSlugError !== null || nextSlug.length === 0;

  // Mirrors the backend's primary-manager gate, so other roles can see the URL
  // but not retire it.
  if (!canEditSettings) {
    return (
      <div className="grid gap-2">
        <span className={fieldLabelClass}>Public URL</span>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          /organizations/{currentSlug}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Only the primary manager can change the public URL.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <label className="grid gap-2">
        <span className={fieldLabelClass}>Public URL</span>
        <div className="flex items-center gap-1">
          <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
            /organizations/
          </span>
          <input
            value={organizationSlug}
            onChange={(event) => {
              setOrganizationSlug(event.target.value);
              setConfirming(false);
            }}
            aria-label="Organization URL slug"
            aria-invalid={organizationSlugError !== null}
            aria-describedby={
              organizationSlugError ? "organization-slug-error" : undefined
            }
            maxLength={160}
            disabled={savingSlug}
            className={`${inputClass} ${
              organizationSlugError
                ? "border-rose-500 focus:border-rose-500 focus:ring-rose-500"
                : ""
            }`}
          />
        </div>
      </label>
      {organizationSlugError ? (
        <p
          id="organization-slug-error"
          role="alert"
          className="text-xs text-rose-600 dark:text-rose-400"
        >
          {organizationSlugError}
        </p>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Lowercase letters, numbers, and single hyphens.
        </p>
      )}
      {changed && !blocked ? (
        confirming ? (
          <div className="grid gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <p
              role="alert"
              className="text-xs text-amber-900 dark:text-amber-200"
            >
              Changing this URL will redirect existing links to the new address.
              The current URL <strong>/organizations/{currentSlug}</strong> will
              keep working forever, and can never be claimed by anyone else.
              This also means it cannot be reused later, including by you.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={savingSlug}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  void handleSaveSlug();
                }}
                disabled={savingSlug}
                className={primaryButtonClass}
              >
                {savingSlug ? "Updating..." : "Confirm new URL"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={savingSlug}
              className={primaryButtonClass}
            >
              Change URL
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}

export function SettingsPanel() {
  const {
    organizationName,
    setOrganizationName,
    profileForm,
    saving,
    handleProfileFormChange,
    handleSaveProfile,
    showWorkspaceToast,
  } = useOrganizationWorkspace();

  return (
    <SectionCard
      eyebrow="Settings"
      title="Organization profile"
      description="Only the primary manager can edit these details. They help renters recognize and reach your organization."
    >
      {/* Outside the profile form on purpose: retiring the public URL is its
          own operation and must not ride along on a profile save. */}
      <div className="mb-6">
        <OrganizationUrlField />
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSaveProfile();
        }}
        className="grid gap-5"
      >
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Name</span>
          <input
            value={organizationName}
            onChange={(event) => setOrganizationName(event.target.value)}
            aria-label="Rename organization"
            maxLength={160}
            className={inputClass}
          />
        </label>
        <OrganizationProfileFieldset
          value={profileForm}
          onChange={handleProfileFormChange}
          onError={(nextMessage) =>
            showWorkspaceToast("Couldn't upload logo", nextMessage)
          }
          disabled={saving}
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || organizationName.trim().length === 0}
            className={primaryButtonClass}
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}
