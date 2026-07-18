"use client";

import { useState } from "react";
import { blobApi } from "@/lib/blob/api";
import {
  dangerButtonClass,
  fieldLabelClass,
  inputClass,
  secondaryButtonClass,
} from "@/components/organizations/shared/styles";
import type { ProfileFormValue } from "@/components/organizations/workspace/forms";

export function OrganizationLogoField({
  logoUrl,
  onUploaded,
  onRemove,
  onError,
  disabled,
}: {
  logoUrl: string;
  onUploaded: (blobUrl: string, blobName: string) => void;
  onRemove: () => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }

    setUploading(true);
    try {
      const target = await blobApi.createUploadUrl({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        scope: "organizations",
      });
      const response = await fetch(target.uploadUrl, {
        method: target.method,
        headers: target.headers,
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}.`);
      }
      onUploaded(target.blobUrl, target.blobName);
    } catch {
      onError("We couldn't upload that logo. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-2">
      <span className={fieldLabelClass}>Logo</span>
      <div className="flex items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Organization logo"
            className="h-16 w-16 shrink-0 rounded-2xl object-cover ring-1 ring-slate-200 dark:ring-slate-700"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-dashed border-slate-300 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
            No logo
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${secondaryButtonClass} cursor-pointer`}>
            {uploading
              ? "Uploading..."
              : logoUrl
                ? "Replace logo"
                : "Upload logo"}
            <input
              type="file"
              accept="image/*"
              aria-label="Upload organization logo"
              className="sr-only"
              disabled={disabled || uploading}
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {logoUrl ? (
            <button
              type="button"
              onClick={onRemove}
              disabled={disabled || uploading}
              className={dangerButtonClass}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function OrganizationProfileFieldset({
  value,
  onChange,
  onError,
  disabled,
}: {
  value: ProfileFormValue;
  onChange: (next: ProfileFormValue) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const update = <K extends keyof ProfileFormValue>(
    key: K,
    next: ProfileFormValue[K],
  ) => onChange({ ...value, [key]: next });

  return (
    <div className="grid gap-5">
      <label className="grid gap-2">
        <span className={fieldLabelClass}>Description</span>
        <textarea
          value={value.description}
          onChange={(event) => update("description", event.target.value)}
          rows={3}
          maxLength={5000}
          disabled={disabled}
          placeholder="Tell renters what your organization is about."
          className={`${inputClass} h-auto py-3`}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Website</span>
          <input
            value={value.websiteUrl}
            onChange={(event) => update("websiteUrl", event.target.value)}
            type="url"
            maxLength={500}
            disabled={disabled}
            placeholder="https://acme-rentals.com"
            className={inputClass}
          />
        </label>
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Contact email</span>
          <input
            value={value.contactEmail}
            onChange={(event) => update("contactEmail", event.target.value)}
            type="email"
            maxLength={320}
            disabled={disabled}
            placeholder="hello@acme-rentals.com"
            className={inputClass}
          />
        </label>
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Contact phone</span>
          <input
            value={value.contactPhone}
            onChange={(event) => update("contactPhone", event.target.value)}
            type="tel"
            maxLength={40}
            disabled={disabled}
            placeholder="+1 (555) 123-4567"
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 sm:col-span-2">
          <span className={fieldLabelClass}>Address line 1</span>
          <input
            value={value.addressLine1}
            onChange={(event) => update("addressLine1", event.target.value)}
            maxLength={200}
            disabled={disabled}
            placeholder="123 Market St"
            className={inputClass}
          />
        </label>
        <label className="grid gap-2 sm:col-span-2">
          <span className={fieldLabelClass}>Address line 2</span>
          <input
            value={value.addressLine2}
            onChange={(event) => update("addressLine2", event.target.value)}
            maxLength={200}
            disabled={disabled}
            placeholder="Suite 400"
            className={inputClass}
          />
        </label>
        <label className="grid gap-2">
          <span className={fieldLabelClass}>City</span>
          <input
            value={value.city}
            onChange={(event) => update("city", event.target.value)}
            maxLength={120}
            disabled={disabled}
            className={inputClass}
          />
        </label>
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Region / State</span>
          <input
            value={value.region}
            onChange={(event) => update("region", event.target.value)}
            maxLength={120}
            disabled={disabled}
            className={inputClass}
          />
        </label>
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Country</span>
          <input
            value={value.country}
            onChange={(event) => update("country", event.target.value)}
            maxLength={120}
            disabled={disabled}
            className={inputClass}
          />
        </label>
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Postal code</span>
          <input
            value={value.postalCode}
            onChange={(event) => update("postalCode", event.target.value)}
            maxLength={20}
            disabled={disabled}
            className={inputClass}
          />
        </label>
      </div>

      <OrganizationLogoField
        logoUrl={value.logoUrl}
        onUploaded={(blobUrl, blobName) =>
          onChange({ ...value, logoUrl: blobUrl, logoBlobName: blobName })
        }
        onRemove={() => onChange({ ...value, logoUrl: "", logoBlobName: "" })}
        onError={onError}
        disabled={disabled}
      />

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className={fieldLabelClass}>Custom fields</span>
          <button
            type="button"
            onClick={() =>
              update("customFields", [
                ...value.customFields,
                { key: "", value: "" },
              ])
            }
            disabled={disabled || value.customFields.length >= 20}
            className={secondaryButtonClass}
          >
            Add field
          </button>
        </div>
        {value.customFields.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Add your own labeled details such as Founded or License #.
          </p>
        ) : (
          <div className="grid gap-2">
            {value.customFields.map((row, index) => (
              <div
                key={index}
                className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]"
              >
                <input
                  value={row.key}
                  onChange={(event) => {
                    const next = [...value.customFields];
                    next[index] = { ...row, key: event.target.value };
                    update("customFields", next);
                  }}
                  maxLength={80}
                  disabled={disabled}
                  placeholder="Label"
                  aria-label={`Custom field ${index + 1} label`}
                  className={inputClass}
                />
                <input
                  value={row.value}
                  onChange={(event) => {
                    const next = [...value.customFields];
                    next[index] = { ...row, value: event.target.value };
                    update("customFields", next);
                  }}
                  maxLength={1000}
                  disabled={disabled}
                  placeholder="Value"
                  aria-label={`Custom field ${index + 1} value`}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() =>
                    update(
                      "customFields",
                      value.customFields.filter((_, i) => i !== index),
                    )
                  }
                  disabled={disabled}
                  className={dangerButtonClass}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
