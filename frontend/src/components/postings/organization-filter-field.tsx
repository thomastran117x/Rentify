"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";

interface OrganizationFilterFieldProps {
  /**
   * What the field starts with: the visitor's own organization text when they
   * typed one, or the resolved organization name when they arrived from an
   * exact-id link.
   */
  defaultValue: string;
  /** Exact organization id from the URL, when the filter came from a link. */
  organizationId?: string;
  inputClassName: string;
}

/**
 * Organization filter input, paired with the exact organization id it came
 * from.
 *
 * The id is only resubmitted while the field still holds the value it resolved
 * to. Editing the text is a request for a name search, so the id is dropped
 * rather than silently overriding whatever the visitor typed.
 */
export function OrganizationFilterField({
  defaultValue,
  organizationId,
  inputClassName,
}: OrganizationFilterFieldProps) {
  const [value, setValue] = useState(defaultValue);
  const keepsOrganizationId =
    organizationId !== undefined && value === defaultValue;

  return (
    <div className="relative">
      <Building2
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
        aria-hidden="true"
      />
      {keepsOrganizationId ? (
        <input type="hidden" name="organizationId" value={organizationId} />
      ) : null}
      <input
        id="organization"
        type="text"
        name="organization"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Any organization"
        className={`${inputClassName} pl-9`}
      />
    </div>
  );
}
