"use client";

import {
  fieldLabelClass,
  inputClass,
  primaryButtonClass,
} from "@/components/organizations/shared/styles";
import { SectionCard } from "@/components/organizations/shared/primitives";
import { OrganizationProfileFieldset } from "@/components/organizations/workspace/profile-fieldset";
import { useOrganizationWorkspace } from "@/components/organizations/workspace/workspace-provider";

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
