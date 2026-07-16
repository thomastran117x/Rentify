"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useAuth } from "@/components/auth/auth-context";
import { FormErrorMessage, useErrorModal } from "@/components/errors";
import { blobApi } from "@/lib/blob/api";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { ApiClientError } from "@/lib/api/types";
import { AvailabilityBadge } from "@/components/postings/availability-badge";
import {
  formatPostingAttributeLabel,
  formatPostingAttributeValue,
  formatPostingPrice,
} from "@/lib/postings/public-format";
import {
  canManageOrganizationPostings,
  canReadOrganizationPostings,
} from "@/lib/auth/roles";
import {
  postingsApi,
  type PostingAvailabilityStatus,
  type PostingDetailValue,
  type PostingFamily,
  type PostingPhotoInput,
  type PostingRecord,
  type PostingStatus,
  type SeasonalPricingRule,
  type SeasonalPricingRuleInput,
  type UpsertPostingInput,
} from "@/lib/postings/api";

type PostingSubtypeOption = {
  value: string;
  label: string;
};

interface PostingFormState {
  postingId: string | null;
  family: PostingFamily;
  subtype: string;
  name: string;
  description: string;
  dailyPriceAmount: string;
  currency: string;
  tags: string[];
  availabilityStatus: PostingAvailabilityStatus;
  availabilityNotes: string;
  maxBookingDurationDays: string;
  minBookingDurationDays: string;
  advanceNoticeDays: string;
  cancellationPolicy: string;
  cancellationPolicyNotes: string;
  instantBooking: boolean;
  city: string;
  region: string;
  country: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  details: Record<string, PostingDetailValue>;
}

interface PhotoItem {
  key: string;
  previewUrl: string;
  file?: File;
  blobUrl?: string;
  blobName?: string;
}

const subtypeOptionsByFamily: Record<PostingFamily, PostingSubtypeOption[]> = {
  place: [
    { value: "workspace", label: "Workspace" },
    { value: "entire_place", label: "Entire place" },
    { value: "private_room", label: "Private room" },
    { value: "storage_space", label: "Storage space" },
  ],
  equipment: [
    { value: "camera", label: "Camera" },
    { value: "tool", label: "Tool" },
    { value: "audio", label: "Audio" },
    { value: "general_equipment", label: "General equipment" },
  ],
  vehicle: [
    { value: "bike", label: "Bike" },
    { value: "car", label: "Car" },
  ],
};

const familyOptions: Array<{ value: PostingFamily; label: string }> = [
  { value: "place", label: "Place" },
  { value: "equipment", label: "Equipment" },
  { value: "vehicle", label: "Vehicle" },
];

const WIZARD_STEPS = [
  { id: "category", title: "Category", blurb: "What are you listing?" },
  { id: "basics", title: "Basics", blurb: "Name and describe it" },
  { id: "location", title: "Location", blurb: "Where it lives" },
  { id: "pricing", title: "Pricing", blurb: "Rates and cancellation" },
  { id: "availability", title: "Availability", blurb: "Booking rules" },
  { id: "details", title: "Details & photos", blurb: "Specs and images" },
  { id: "review", title: "Review", blurb: "Check and submit" },
] as const;

const REVIEW_STEP = WIZARD_STEPS.length - 1;

function createDefaultDetails(
  family: PostingFamily,
  subtype: string,
): Record<string, PostingDetailValue> {
  if (family === "place") {
    return {
      guest_capacity: 4,
      property_type: subtype === "workspace" ? "studio" : "loft",
      amenities: ["wifi", "coffee"],
      parking: false,
    };
  }

  if (family === "equipment") {
    return {
      condition: "excellent",
      brand: "Example",
      model: "Creator Kit",
      includes_delivery: false,
      weight_lb: 8,
    };
  }

  return {
    make: "Example",
    model: "City Cruiser",
    year: 2024,
    seats: subtype === "car" ? 5 : 1,
    license_class: subtype === "car" ? "G" : "standard",
  };
}

function createDefaultFormState(): PostingFormState {
  return {
    postingId: null,
    family: "place",
    subtype: "workspace",
    name: "",
    description: "",
    dailyPriceAmount: "150",
    currency: "CAD",
    tags: ["workspace", "wifi"],
    availabilityStatus: "available",
    availabilityNotes: "",
    maxBookingDurationDays: "14",
    minBookingDurationDays: "",
    advanceNoticeDays: "",
    cancellationPolicy: "",
    cancellationPolicyNotes: "",
    instantBooking: false,
    city: "Toronto",
    region: "Ontario",
    country: "Canada",
    postalCode: "",
    latitude: "43.6532",
    longitude: "-79.3832",
    details: createDefaultDetails("place", "workspace"),
  };
}

function formatStatus(status: PostingStatus): string {
  return status[0]?.toUpperCase() + status.slice(1);
}

function formatVariant(posting: PostingRecord): string {
  return `${posting.variant.family} / ${posting.variant.subtype}`.replaceAll(
    "_",
    " ",
  );
}

function formatVariantLabel(family: PostingFamily, subtype: string): string {
  return `${family} / ${subtype}`.replaceAll("_", " ");
}

function toFormState(posting: PostingRecord): PostingFormState {
  return {
    postingId: posting.id,
    family: posting.variant.family,
    subtype: posting.variant.subtype,
    name: posting.name,
    description: posting.description,
    dailyPriceAmount: String(posting.pricing.daily.amount),
    currency: posting.pricing.currency,
    tags: posting.tags,
    availabilityStatus: posting.availabilityStatus,
    availabilityNotes: posting.availabilityNotes ?? "",
    maxBookingDurationDays: posting.maxBookingDurationDays
      ? String(posting.maxBookingDurationDays)
      : "",
    minBookingDurationDays:
      posting.minBookingDurationDays != null
        ? String(posting.minBookingDurationDays)
        : "",
    advanceNoticeDays:
      posting.advanceNoticeDays != null
        ? String(posting.advanceNoticeDays)
        : "",
    cancellationPolicy: posting.cancellationPolicy ?? "",
    cancellationPolicyNotes: posting.cancellationPolicyNotes ?? "",
    instantBooking: posting.instantBooking ?? false,
    city: posting.location.city,
    region: posting.location.region,
    country: posting.location.country,
    postalCode: posting.location.postalCode ?? "",
    latitude: String(posting.location.latitude),
    longitude: String(posting.location.longitude),
    details: posting.details,
  };
}

function photoItemsFromPosting(posting: PostingRecord): PhotoItem[] {
  return [...posting.photos]
    .sort((a, b) => a.position - b.position)
    .map((photo, index) => ({
      key: `existing-${photo.blobName}-${index}`,
      previewUrl: photo.thumbnailBlobUrl ?? photo.blobUrl,
      blobUrl: photo.blobUrl,
      blobName: photo.blobName,
    }));
}

function buildPayload(
  form: PostingFormState,
  photos: PostingPhotoInput[],
): UpsertPostingInput {
  if (photos.length === 0) {
    throw new Error("Upload at least one photo before saving.");
  }

  return {
    variant: {
      family: form.family,
      subtype: form.subtype,
    },
    name: form.name.trim(),
    description: form.description.trim(),
    pricing: {
      currency: form.currency.trim().toUpperCase(),
      daily: {
        amount: Number(form.dailyPriceAmount),
      },
    },
    photos,
    tags: form.tags.map((value) => value.trim()).filter(Boolean),
    details: form.details,
    availabilityStatus: form.availabilityStatus,
    availabilityNotes: form.availabilityNotes.trim() || null,
    maxBookingDurationDays: form.maxBookingDurationDays.trim()
      ? Number(form.maxBookingDurationDays)
      : null,
    minBookingDurationDays: form.minBookingDurationDays.trim()
      ? Number(form.minBookingDurationDays)
      : null,
    advanceNoticeDays: form.advanceNoticeDays.trim()
      ? Number(form.advanceNoticeDays)
      : null,
    cancellationPolicy:
      (form.cancellationPolicy as "flexible" | "moderate" | "strict") || null,
    cancellationPolicyNotes: form.cancellationPolicyNotes.trim() || null,
    instantBooking: form.instantBooking,
    location: {
      city: form.city.trim(),
      region: form.region.trim(),
      country: form.country.trim(),
      postalCode: form.postalCode.trim() || null,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
    },
  };
}

async function uploadManagedPhoto(file: File): Promise<PostingPhotoInput> {
  const uploadTarget = await blobApi.createUploadUrl({
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    scope: "postings",
  });
  const response = await fetch(uploadTarget.uploadUrl, {
    method: uploadTarget.method,
    headers: uploadTarget.headers,
    body: file,
  });

  if (!response.ok) {
    throw new Error("Photo upload failed before the posting could be saved.");
  }

  return {
    blobUrl: uploadTarget.blobUrl,
    blobName: uploadTarget.blobName,
    position: 0,
  };
}

function getCompletenessItems(
  form: PostingFormState,
  photoCount: number,
): Array<{ label: string; done: boolean }> {
  const tags = form.tags.map((t) => t.trim()).filter(Boolean);

  return [
    { label: "Description (100+ chars)", done: form.description.length >= 100 },
    { label: "At least 3 photos", done: photoCount >= 3 },
    { label: "At least 2 tags", done: tags.length >= 2 },
    { label: "Cancellation policy set", done: !!form.cancellationPolicy },
    {
      label: "Availability notes added",
      done: !!form.availabilityNotes.trim(),
    },
    {
      label: "Minimum booking duration",
      done: !!form.minBookingDurationDays.trim(),
    },
    {
      label: "Maximum booking duration",
      done: !!form.maxBookingDurationDays.trim(),
    },
    {
      label: "Advance notice configured",
      done: !!form.advanceNoticeDays.trim(),
    },
  ];
}

function buildLifecycleActions(status: PostingStatus): Array<{
  id: "publish" | "pause" | "unpause" | "archive";
  label: string;
}> {
  if (status === "draft") {
    return [
      { id: "publish", label: "Publish" },
      { id: "archive", label: "Archive" },
    ];
  }

  if (status === "published") {
    return [
      { id: "pause", label: "Pause" },
      { id: "archive", label: "Archive" },
    ];
  }

  if (status === "paused") {
    return [
      { id: "unpause", label: "Unpause" },
      { id: "archive", label: "Archive" },
    ];
  }

  return [];
}

type StepId = (typeof WIZARD_STEPS)[number]["id"];

function validateStep(
  stepId: StepId,
  form: PostingFormState,
  photoCount: number,
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (stepId === "basics") {
    if (!form.name.trim()) {
      errors.name = "Give your listing a name.";
    }
    if (!form.description.trim()) {
      errors.description = "Add a description so renters know what to expect.";
    }
  } else if (stepId === "location") {
    if (!form.city.trim()) errors.city = "City is required.";
    if (!form.region.trim()) errors.region = "Region is required.";
    if (!form.country.trim()) errors.country = "Country is required.";

    const latitude = Number(form.latitude);
    if (
      form.latitude.trim() === "" ||
      Number.isNaN(latitude) ||
      latitude < -90 ||
      latitude > 90
    ) {
      errors.latitude = "Latitude must be between -90 and 90.";
    }

    const longitude = Number(form.longitude);
    if (
      form.longitude.trim() === "" ||
      Number.isNaN(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      errors.longitude = "Longitude must be between -180 and 180.";
    }
  } else if (stepId === "pricing") {
    const amount = Number(form.dailyPriceAmount);
    if (
      form.dailyPriceAmount.trim() === "" ||
      Number.isNaN(amount) ||
      amount <= 0
    ) {
      errors.dailyPriceAmount = "Enter a daily price greater than 0.";
    }
    if (!form.currency.trim()) {
      errors.currency = "Currency is required.";
    }
  } else if (stepId === "availability") {
    const numericFields: Array<[keyof PostingFormState, string]> = [
      ["maxBookingDurationDays", "Max booking days"],
      ["minBookingDurationDays", "Min booking days"],
      ["advanceNoticeDays", "Advance notice"],
    ];
    for (const [key, label] of numericFields) {
      const raw = String(form[key]).trim();
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0) {
        errors[key as string] = `${label} must be a whole number.`;
      }
    }
  } else if (stepId === "details") {
    if (photoCount < 1) {
      errors.photos = "Add at least one photo before continuing.";
    }
  }

  return errors;
}

function readValidationDetails(
  error: unknown,
): Array<{ path: string; message: string }> {
  if (!(error instanceof ApiClientError) || !Array.isArray(error.details)) {
    return [];
  }

  return error.details.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const message =
      typeof record.message === "string" ? record.message.trim() : "";
    if (!message) {
      return [];
    }
    const path = typeof record.path === "string" ? record.path : "";
    return [{ path, message }];
  });
}

const POSTING_STATUS_STYLES: Record<PostingStatus, string> = {
  draft:
    "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  published:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  paused:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  archived:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
};

const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition duration-200 placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-500/20";

const textareaClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition duration-200 placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-500/20";

const labelText = "text-sm font-medium text-slate-700 dark:text-slate-200";

const primaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-md hover:shadow-violet-600/25 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300";

function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-slate-50 dark:bg-slate-950">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(124,58,237,0.10),transparent_32%),radial-gradient(circle_at_88%_4%,rgba(99,102,241,0.08),transparent_30%)]"
      />
      <div className="relative mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        {children}
      </div>
    </main>
  );
}

function PostingStatusBadge({ status }: { status: PostingStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${POSTING_STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

const inputErrorClass =
  "border-rose-300 focus:border-rose-400 focus:ring-rose-100 dark:border-rose-700 dark:focus:border-rose-500 dark:focus:ring-rose-500/20";

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return (
    <span className="text-xs font-medium text-rose-600 dark:text-rose-400">
      {message}
    </span>
  );
}

function LockIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
    </svg>
  );
}

function TextField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  hint,
  error,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
  error?: string;
  type?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className={labelText}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        className={`${inputClass} ${error ? inputErrorClass : ""}`}
      />
      {error ? (
        <FieldError message={error} />
      ) : hint ? (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className={labelText}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={`${inputClass} cursor-pointer`}
      >
        {children}
      </select>
    </label>
  );
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function TagInput({
  values,
  onChange,
  disabled,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function addTag(raw: string) {
    const tag = raw.trim();
    setDraft("");
    if (!tag || values.includes(tag)) {
      return;
    }
    onChange([...values, tag]);
  }

  function removeTag(tag: string) {
    onChange(values.filter((value) => value !== tag));
  }

  return (
    <div
      className={`flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 transition duration-200 dark:border-slate-700 dark:bg-slate-900 ${
        disabled
          ? "opacity-70"
          : "focus-within:border-violet-400 focus-within:ring-4 focus-within:ring-violet-100 dark:focus-within:border-violet-400 dark:focus-within:ring-violet-500/20"
      }`}
    >
      {values.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
        >
          {tag}
          {!disabled ? (
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label={`Remove ${tag}`}
              className="text-violet-400 transition hover:text-violet-700 dark:hover:text-violet-200"
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
      {!disabled ? (
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag(draft);
            } else if (
              event.key === "Backspace" &&
              draft === "" &&
              values.length > 0
            ) {
              removeTag(values[values.length - 1]);
            }
          }}
          onBlur={() => addTag(draft)}
          placeholder={values.length === 0 ? placeholder : "Add another…"}
          className="min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
      ) : null}
    </div>
  );
}

function DetailsEditor({
  details,
  onChange,
  disabled,
}: {
  details: Record<string, PostingDetailValue>;
  onChange: (next: Record<string, PostingDetailValue>) => void;
  disabled?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(details);

  function setValue(key: string, value: PostingDetailValue) {
    onChange({ ...details, [key]: value });
  }

  function removeKey(key: string) {
    const next = { ...details };
    delete next[key];
    onChange(next);
  }

  function addField() {
    const key = newKey.trim().toLowerCase().replace(/\s+/g, "_");
    setNewKey("");
    if (!key || key in details) {
      return;
    }
    onChange({ ...details, [key]: "" });
  }

  return (
    <div className="grid gap-4">
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No attributes yet. Add one below.
        </p>
      ) : null}

      {entries.map(([key, value]) => (
        <div key={key} className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className={labelText}>{humanizeKey(key)}</span>
            {!disabled ? (
              <button
                type="button"
                onClick={() => removeKey(key)}
                className="text-xs font-semibold text-rose-500 transition hover:underline dark:text-rose-400"
              >
                Remove
              </button>
            ) : null}
          </div>

          {Array.isArray(value) ? (
            <TagInput
              values={value}
              onChange={(next) => setValue(key, next)}
              disabled={disabled}
              placeholder="Add a value and press Enter"
            />
          ) : typeof value === "boolean" ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={value}
                onChange={(event) => setValue(key, event.target.checked)}
                disabled={disabled}
                className="h-4 w-4 cursor-pointer rounded accent-violet-600"
              />
              {value ? "Yes" : "No"}
            </label>
          ) : typeof value === "number" ? (
            <input
              type="number"
              value={Number.isFinite(value) ? value : ""}
              onChange={(event) =>
                setValue(
                  key,
                  event.target.value === "" ? 0 : Number(event.target.value),
                )
              }
              disabled={disabled}
              className={inputClass}
            />
          ) : (
            <input
              type="text"
              value={value}
              onChange={(event) => setValue(key, event.target.value)}
              disabled={disabled}
              className={inputClass}
            />
          )}
        </div>
      ))}

      {!disabled ? (
        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <input
            value={newKey}
            onChange={(event) => setNewKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addField();
              }
            }}
            placeholder="Add attribute (e.g. floor area)"
            aria-label="New attribute name"
            className={`${inputClass} sm:max-w-xs`}
          />
          <button
            type="button"
            onClick={addField}
            className={secondaryButtonClass}
          >
            Add attribute
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PhotoUploader({
  photos,
  primaryKey,
  onAddFiles,
  onRemove,
  onSetPrimary,
  disabled,
  error,
}: {
  photos: PhotoItem[];
  primaryKey: string | null;
  onAddFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (key: string) => void;
  onSetPrimary: (key: string) => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className="grid gap-3">
      {!disabled ? (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition hover:border-violet-300 hover:bg-violet-50/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-violet-800 dark:hover:bg-violet-950/20">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Upload photos
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            PNG or JPG. Add several — pick one as the primary display.
          </span>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={onAddFiles}
            aria-label="Upload photos"
            className="sr-only"
          />
        </label>
      ) : null}

      <FieldError message={error} />

      {photos.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No photos yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo) => {
            const isPrimary = photo.key === primaryKey;
            return (
              <div
                key={photo.key}
                className={`relative overflow-hidden rounded-2xl border ${
                  isPrimary
                    ? "border-violet-400 ring-2 ring-violet-200 dark:ring-violet-500/30"
                    : "border-slate-200 dark:border-slate-800"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.previewUrl}
                  alt="Posting photo preview"
                  className="aspect-[4/3] w-full object-cover"
                />
                {isPrimary ? (
                  <span className="absolute left-2 top-2 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Primary
                  </span>
                ) : null}
                {!disabled ? (
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-slate-950/70 to-transparent p-2">
                    {!isPrimary ? (
                      <button
                        type="button"
                        onClick={() => onSetPrimary(photo.key)}
                        className="rounded-full bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-800 transition hover:bg-white"
                      >
                        Set primary
                      </button>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      onClick={() => onRemove(photo.key)}
                      aria-label="Remove photo"
                      className="rounded-full bg-white/90 px-2 py-1 text-[11px] font-semibold text-rose-600 transition hover:bg-white"
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function safeFormatPrice(amountRaw: string, currencyRaw: string): string {
  const amount = Number(amountRaw);
  const currency = currencyRaw.trim().toUpperCase();
  if (!Number.isFinite(amount) || currency.length !== 3) {
    return `${amountRaw || "0"} ${currency}`.trim();
  }
  try {
    return formatPostingPrice(amount, currency);
  } catch {
    return `${amount} ${currency}`;
  }
}

function ListingPreview({
  form,
  photos,
  primaryKey,
}: {
  form: PostingFormState;
  photos: PhotoItem[];
  primaryKey: string | null;
}) {
  const primaryPhoto =
    photos.find((photo) => photo.key === primaryKey) ?? photos[0];
  const [heroKey, setHeroKey] = useState<string | null>(null);
  const heroPhoto =
    photos.find((photo) => photo.key === heroKey) ?? primaryPhoto;
  const location = [form.city, form.region, form.country]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  const detailEntries = Object.entries(form.details);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {heroPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={heroPhoto.previewUrl}
          alt="Primary photo preview"
          className="aspect-[16/9] w-full object-cover"
        />
      ) : (
        <div className="flex aspect-[16/9] w-full items-center justify-center bg-gradient-to-br from-violet-100 to-indigo-100 text-sm font-medium text-violet-700 dark:from-violet-950/40 dark:to-indigo-950/40 dark:text-violet-300">
          No photo yet
        </div>
      )}

      {photos.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto border-b border-slate-100 p-2 dark:border-slate-800">
          {photos.map((photo, index) => (
            <button
              key={photo.key}
              type="button"
              onClick={() => setHeroKey(photo.key)}
              aria-label={`Show photo ${index + 1}`}
              aria-pressed={photo.key === heroPhoto?.key}
              className={`relative shrink-0 overflow-hidden rounded-lg transition ${
                photo.key === heroPhoto?.key
                  ? "ring-2 ring-violet-400"
                  : "ring-1 ring-slate-200 hover:ring-violet-300 dark:ring-slate-700 dark:hover:ring-violet-700"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.previewUrl}
                alt=""
                className="h-14 w-20 object-cover"
              />
              {photo.key === (primaryPhoto?.key ?? null) ? (
                <span className="absolute left-1 top-1 rounded bg-violet-600 px-1 py-0.5 text-[9px] font-semibold uppercase leading-none text-white">
                  Primary
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-slate-950 dark:text-white">
              {form.name || "Untitled listing"}
            </h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {location || "Location to be added"}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-semibold text-slate-950 dark:text-white">
              {safeFormatPrice(form.dailyPriceAmount, form.currency)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              per day
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <AvailabilityBadge status={form.availabilityStatus} />
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium capitalize text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {formatVariantLabel(form.family, form.subtype)}
          </span>
          {form.instantBooking ? (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300">
              Instant book
            </span>
          ) : null}
        </div>

        {form.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {form.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {form.description.trim() ? (
          <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-slate-300">
            {form.description}
          </p>
        ) : null}

        {detailEntries.length > 0 ? (
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            {detailEntries.map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="text-xs text-slate-400 dark:text-slate-500">
                  {formatPostingAttributeLabel(key)}
                </dt>
                <dd className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                  {formatPostingAttributeValue(value) || "—"}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  );
}

export function PostingManagementWorkspace() {
  const router = useRouter();
  const { status, session } = useAuth();
  const { showErrorModal } = useErrorModal();
  const [postings, setPostings] = useState<PostingRecord[]>([]);
  const [form, setForm] = useState<PostingFormState>(createDefaultFormState());
  const [selectedPostingId, setSelectedPostingId] = useState<string | null>(
    null,
  );
  const [photoItems, setPhotoItems] = useState<PhotoItem[]>([]);
  const [primaryPhotoKey, setPrimaryPhotoKey] = useState<string | null>(null);
  const photoKeyRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [maxStepReached, setMaxStepReached] = useState(0);
  const [showStepErrors, setShowStepErrors] = useState(false);
  const [seasonalRules, setSeasonalRules] = useState<SeasonalPricingRule[]>([]);
  const [seasonalForm, setSeasonalForm] = useState<
    SeasonalPricingRuleInput & { editingId: string | null }
  >({
    editingId: null,
    name: "",
    startDate: "",
    endDate: "",
    dailyAmount: 0,
  });
  const [seasonalError, setSeasonalError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login?next=/postings/create");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const requestedPostingId =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("posting")
            : null;
        const result = await postingsApi.listMine();

        if (!active) {
          return;
        }

        startTransition(() => {
          setPostings(result.postings);
          setSelectedPostingId(result.postings[0]?.id ?? null);
        });

        // Deep link (?posting=<id>) opens that posting straight into the
        // wizard. Fetch it directly by id so it works even when the posting is
        // on a later page of the owner listing (best-effort — a bad id keeps
        // the list view).
        if (requestedPostingId) {
          try {
            const detailPosting = (await postingsApi.getPosting(
              requestedPostingId,
            )) as PostingRecord;

            if (!active) {
              return;
            }

            if ("organizationId" in detailPosting) {
              const rules = await postingsApi
                .listSeasonalPricing(requestedPostingId)
                .catch(() => []);

              if (!active) {
                return;
              }

              const items = photoItemsFromPosting(detailPosting);

              startTransition(() => {
                setSelectedPostingId(detailPosting.id);
                setForm(toFormState(detailPosting));
                setPhotoItems(items);
                setPrimaryPhotoKey(items[0]?.key ?? null);
                setSeasonalRules(rules);
                setCurrentStep(0);
                setMaxStepReached(REVIEW_STEP);
                setEditorOpen(true);
              });
            }
          } catch {
            // Requested posting is unavailable; stay on the list view.
          }
        }
      } catch (nextError) {
        if (active) {
          setError(
            getApiErrorMessage(nextError, {
              action: "load your posting workspace",
              fallback:
                "We couldn't load your posting workspace right now. Please try again.",
            }),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [status]);

  useEffect(() => {
    setShowStepErrors(false);
  }, [currentStep]);

  function nextPhotoKey() {
    photoKeyRef.current += 1;
    return `photo-${photoKeyRef.current}`;
  }

  function handleAddFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }

    const additions: PhotoItem[] = files.map((file) => ({
      key: nextPhotoKey(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setPhotoItems((current) => [...current, ...additions]);
    setPrimaryPhotoKey((current) => current ?? additions[0]?.key ?? null);
    setShowStepErrors(true);
  }

  function handleRemovePhoto(key: string) {
    const target = photoItems.find((item) => item.key === key);
    if (target?.file) {
      URL.revokeObjectURL(target.previewUrl);
    }

    const remaining = photoItems.filter((item) => item.key !== key);
    setPhotoItems(remaining);
    if (primaryPhotoKey === key) {
      setPrimaryPhotoKey(remaining[0]?.key ?? null);
    }
    setShowStepErrors(true);
  }

  function handleSetPrimary(key: string) {
    setPrimaryPhotoKey(key);
  }

  function resetPhotos(next: PhotoItem[] = []) {
    for (const item of photoItems) {
      if (item.file) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
    setPhotoItems(next);
    setPrimaryPhotoKey(next[0]?.key ?? null);
  }

  const activeOrganization = session?.user.activeOrganization;
  const canRead = canReadOrganizationPostings(activeOrganization);
  const canManage = canManageOrganizationPostings(activeOrganization);
  const isEditing = form.postingId !== null;

  async function savePostingRequest() {
    const uploaded = await Promise.all(
      photoItems.map(async (item) => {
        if (item.file) {
          const photo = await uploadManagedPhoto(item.file);
          return {
            key: item.key,
            blobUrl: photo.blobUrl,
            blobName: photo.blobName,
          };
        }
        return {
          key: item.key,
          blobUrl: item.blobUrl ?? "",
          blobName: item.blobName ?? "",
        };
      }),
    );

    // Primary photo must be position 0; the rest keep their order after it.
    const ordered = [
      ...uploaded.filter((photo) => photo.key === primaryPhotoKey),
      ...uploaded.filter((photo) => photo.key !== primaryPhotoKey),
    ];
    const nextPhotos: PostingPhotoInput[] = ordered.map((photo, index) => ({
      blobUrl: photo.blobUrl,
      blobName: photo.blobName,
      position: index,
    }));

    const payload = buildPayload(form, nextPhotos);
    const saved = form.postingId
      ? await postingsApi.update(form.postingId, payload)
      : await postingsApi.create(payload);

    await refresh(saved.id);
    setEditorOpen(false);
    setMessage(
      form.postingId
        ? "Posting updated for your active organization."
        : "Draft created for your active organization.",
    );
  }

  async function lifecycleActionRequest(
    postingId: string,
    action: "publish" | "pause" | "unpause" | "archive",
  ) {
    if (action === "publish") {
      await postingsApi.publish(postingId);
    } else if (action === "pause") {
      await postingsApi.pausePosting(postingId);
    } else if (action === "unpause") {
      await postingsApi.unpausePosting(postingId);
    } else {
      await postingsApi.archive(postingId);
    }

    await refresh(postingId);
    setMessage(`Posting ${action} action completed.`);
  }

  async function refresh(preferredPostingId?: string | null) {
    const result = await postingsApi.listMine();
    const nextPostingId =
      preferredPostingId ?? selectedPostingId ?? result.postings[0]?.id ?? null;

    startTransition(() => {
      setPostings(result.postings);
      setSelectedPostingId(nextPostingId);
    });

    if (nextPostingId) {
      await handleSelectPosting(nextPostingId, false);
    } else {
      startTransition(() => {
        setForm(createDefaultFormState());
      });
    }
  }

  async function handleSelectPosting(postingId: string, clearMessages = true) {
    if (clearMessages) {
      setError(null);
      setMessage(null);
    }

    const nextPosting = (await postingsApi.getPosting(
      postingId,
    )) as PostingRecord;

    if (!("organizationId" in nextPosting)) {
      throw new Error("Managed posting details were not available.");
    }

    const rules = await postingsApi
      .listSeasonalPricing(postingId)
      .catch(() => []);

    for (const item of photoItems) {
      if (item.file) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
    const items = photoItemsFromPosting(nextPosting);

    startTransition(() => {
      setSelectedPostingId(postingId);
      setForm(toFormState(nextPosting));
      setPhotoItems(items);
      setPrimaryPhotoKey(items[0]?.key ?? null);
      setSeasonalRules(rules);
      setSeasonalForm({
        editingId: null,
        name: "",
        startDate: "",
        endDate: "",
        dailyAmount: 0,
      });
      setSeasonalError(null);
    });
  }

  function openNewDraft() {
    setSelectedPostingId(null);
    resetPhotos();
    setShowStepErrors(false);
    setMessage(null);
    setError(null);
    setForm(createDefaultFormState());
    setSeasonalRules([]);
    setSeasonalForm({
      editingId: null,
      name: "",
      startDate: "",
      endDate: "",
      dailyAmount: 0,
    });
    setSeasonalError(null);
    setCurrentStep(0);
    setMaxStepReached(0);
    setEditorOpen(true);
  }

  async function openPosting(postingId: string) {
    setSaving(true);

    try {
      await handleSelectPosting(postingId);
      setCurrentStep(0);
      setMaxStepReached(REVIEW_STEP);
      setEditorOpen(true);
    } catch (nextError) {
      setError(
        getApiErrorMessage(nextError, {
          action: "open this posting",
          fallback:
            "We couldn't open this posting right now. Please try again.",
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  function closeEditor() {
    setEditorOpen(false);
    setError(null);
  }

  async function handleSave() {
    if (!canManage) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      await savePostingRequest();
    } catch (nextError) {
      const baseMessage = getApiErrorMessage(nextError, {
        action: "save this posting",
        fallback: "We couldn't save this posting right now. Please try again.",
        preserveUnknownErrorMessage: true,
      });
      const details = readValidationDetails(nextError);

      const message: ReactNode =
        details.length > 0 ? (
          <div className="space-y-2">
            <p>{baseMessage}</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {details.map((detail, index) => (
                <li key={`${detail.path}-${index}`}>
                  {detail.path ? (
                    <>
                      <span className="font-medium">
                        {humanizeKey(
                          detail.path.split(".").pop() ?? detail.path,
                        )}
                      </span>
                      : {detail.message}
                    </>
                  ) : (
                    detail.message
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          baseMessage
        );

      showErrorModal({
        title: "Couldn't save posting",
        message,
        actionLabel: "Keep editing",
        onAction: () => {},
        retryLabel: "Retry save",
        onRetry: savePostingRequest,
        dedupeKey: `posting-save-${form.postingId ?? "draft"}`,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleLifecycleAction(
    postingId: string,
    action: "publish" | "pause" | "unpause" | "archive",
  ) {
    if (!canManage) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      await lifecycleActionRequest(postingId, action);
    } catch (nextError) {
      const message = getApiErrorMessage(nextError, {
        action: `update this posting's ${action} status`,
        fallback:
          "We couldn't update this posting's status right now. Please try again.",
      });

      showErrorModal({
        title: "Couldn't update posting status",
        message,
        actionLabel: "Keep editing",
        onAction: () => {},
        retryLabel: `Retry ${action}`,
        onRetry: () => lifecycleActionRequest(postingId, action),
        dedupeKey: `posting-lifecycle-${postingId}-${action}`,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSeasonalSubmit() {
    if (!selectedPostingId) return;
    setSeasonalError(null);
    const input: SeasonalPricingRuleInput = {
      name: seasonalForm.name.trim(),
      startDate: seasonalForm.startDate,
      endDate: seasonalForm.endDate,
      dailyAmount: Number(seasonalForm.dailyAmount),
    };
    try {
      if (seasonalForm.editingId) {
        const updated = await postingsApi.updateSeasonalPricingRule(
          selectedPostingId,
          seasonalForm.editingId,
          input,
        );
        setSeasonalRules((r) =>
          r.map((x) => (x.id === updated.id ? updated : x)),
        );
      } else {
        const created = await postingsApi.createSeasonalPricingRule(
          selectedPostingId,
          input,
        );
        setSeasonalRules((r) => [...r, created]);
      }
      setSeasonalForm({
        editingId: null,
        name: "",
        startDate: "",
        endDate: "",
        dailyAmount: 0,
      });
    } catch (err) {
      setSeasonalError(
        getApiErrorMessage(err, {
          action: "save seasonal pricing rule",
          fallback: "Could not save rule.",
        }),
      );
    }
  }

  async function handleSeasonalDelete(ruleId: string) {
    if (!selectedPostingId) return;
    try {
      await postingsApi.deleteSeasonalPricingRule(selectedPostingId, ruleId);
      setSeasonalRules((r) => r.filter((x) => x.id !== ruleId));
    } catch (err) {
      setSeasonalError(
        getApiErrorMessage(err, {
          action: "delete seasonal pricing rule",
          fallback: "Could not delete rule.",
        }),
      );
    }
  }

  function handleFamilyChange(family: PostingFamily) {
    const nextSubtype = subtypeOptionsByFamily[family][0]?.value ?? "workspace";

    setForm((current) => ({
      ...current,
      family,
      subtype: nextSubtype,
      details: createDefaultDetails(family, nextSubtype),
    }));
  }

  function handleSubtypeChange(subtype: string) {
    setForm((current) => ({
      ...current,
      subtype,
      details: createDefaultDetails(current.family, subtype),
    }));
  }

  function updateField<TKey extends keyof PostingFormState>(
    key: TKey,
    value: PostingFormState[TKey],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setShowStepErrors(true);
  }

  if (status === "loading" || loading) {
    return (
      <PageShell>
        <div className="h-40 animate-pulse rounded-[1.8rem] bg-slate-200/70 dark:bg-slate-800/70" />
        <div className="h-64 animate-pulse rounded-[1.8rem] bg-slate-200/70 dark:bg-slate-800/70" />
      </PageShell>
    );
  }

  if (status !== "authenticated" || !session) {
    return null;
  }

  if (!canRead) {
    return (
      <PageShell>
        <div className="rounded-[1.8rem] border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            Posting workspace
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
            Select an organization first
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
            Posting management follows your active organization. Switch into an
            organization workspace first, then come back here to manage its
            postings.
          </p>
          <Link href="/dashboard/organizations" className={`${primaryButtonClass} mt-6`}>
            Open organizations
          </Link>
        </div>
      </PageShell>
    );
  }

  const disabled = !canManage || saving;
  const completeness = getCompletenessItems(form, photoItems.length);
  const completedCount = completeness.filter((item) => item.done).length;
  const completenessPct = Math.round(
    (completedCount / completeness.length) * 100,
  );
  const currentStepId = WIZARD_STEPS[currentStep].id;
  const stepErrors: Record<string, string> = showStepErrors
    ? validateStep(currentStepId, form, photoItems.length)
    : {};
  const isStepValid = (index: number) =>
    Object.keys(validateStep(WIZARD_STEPS[index].id, form, photoItems.length))
      .length === 0;
  const currentStepValid = isStepValid(currentStep);
  const canSubmit = WIZARD_STEPS.slice(0, REVIEW_STEP).every((_, index) =>
    isStepValid(index),
  );

  function renderStepBody() {
    const step = WIZARD_STEPS[currentStep];

    if (step.id === "category") {
      return (
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            label="Family"
            value={form.family}
            onChange={(value) => handleFamilyChange(value as PostingFamily)}
            disabled={disabled}
          >
            {familyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Subtype"
            value={form.subtype}
            onChange={handleSubtypeChange}
            disabled={disabled}
          >
            {subtypeOptionsByFamily[form.family].map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
        </div>
      );
    }

    if (step.id === "basics") {
      return (
        <div className="grid gap-5">
          <TextField
            label="Name"
            value={form.name}
            onChange={(value) => updateField("name", value)}
            disabled={disabled}
            placeholder="Downtown creative studio"
            error={stepErrors.name}
          />
          <label className="grid gap-1.5">
            <span className={labelText}>Description</span>
            <textarea
              value={form.description}
              onChange={(event) =>
                updateField("description", event.target.value)
              }
              disabled={disabled}
              rows={6}
              aria-invalid={stepErrors.description ? true : undefined}
              className={`${textareaClass} ${stepErrors.description ? inputErrorClass : ""}`}
              placeholder="Describe the space, what's included, and who it's great for."
            />
            {stepErrors.description ? (
              <FieldError message={stepErrors.description} />
            ) : (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {form.description.length} characters · aim for 100+.
              </span>
            )}
          </label>
          <div className="grid gap-1.5">
            <span className={labelText}>Tags</span>
            <TagInput
              values={form.tags}
              onChange={(next) => updateField("tags", next)}
              disabled={disabled}
              placeholder="Type a tag and press Enter"
            />
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Keywords renters can search — press Enter or comma to add each
              one.
            </span>
          </div>
        </div>
      );
    }

    if (step.id === "location") {
      return (
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="City"
            value={form.city}
            onChange={(value) => updateField("city", value)}
            disabled={disabled}
            error={stepErrors.city}
          />
          <TextField
            label="Region"
            value={form.region}
            onChange={(value) => updateField("region", value)}
            disabled={disabled}
            error={stepErrors.region}
          />
          <TextField
            label="Country"
            value={form.country}
            onChange={(value) => updateField("country", value)}
            disabled={disabled}
            error={stepErrors.country}
          />
          <TextField
            label="Postal code"
            value={form.postalCode}
            onChange={(value) => updateField("postalCode", value)}
            disabled={disabled}
          />
          <TextField
            label="Latitude"
            value={form.latitude}
            onChange={(value) => updateField("latitude", value)}
            disabled={disabled}
            error={stepErrors.latitude}
          />
          <TextField
            label="Longitude"
            value={form.longitude}
            onChange={(value) => updateField("longitude", value)}
            disabled={disabled}
            error={stepErrors.longitude}
          />
        </div>
      );
    }

    if (step.id === "pricing") {
      return (
        <div className="grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label="Daily price"
              value={form.dailyPriceAmount}
              onChange={(value) => updateField("dailyPriceAmount", value)}
              disabled={disabled}
              type="number"
              error={stepErrors.dailyPriceAmount}
            />
            <TextField
              label="Currency"
              value={form.currency}
              onChange={(value) => updateField("currency", value)}
              disabled={disabled}
              error={stepErrors.currency}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              label="Cancellation policy"
              value={form.cancellationPolicy}
              onChange={(value) => updateField("cancellationPolicy", value)}
              disabled={disabled}
            >
              <option value="">Not specified</option>
              <option value="flexible">Flexible</option>
              <option value="moderate">Moderate</option>
              <option value="strict">Strict</option>
            </SelectField>
            <TextField
              label="Cancellation notes"
              value={form.cancellationPolicyNotes}
              onChange={(value) =>
                updateField("cancellationPolicyNotes", value)
              }
              disabled={disabled}
            />
          </div>

          {selectedPostingId ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Seasonal pricing
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Override the daily rate for specific date ranges (holidays, peak
                season).
              </p>

              {seasonalRules.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {seasonalRules.map((rule) => (
                    <li
                      key={rule.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{rule.name}</p>
                        <p className="text-slate-500 dark:text-slate-400">
                          {rule.startDate} → {rule.endDate} · $
                          {rule.dailyAmount}/day
                        </p>
                      </div>
                      {canManage ? (
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setSeasonalForm({
                                editingId: rule.id,
                                name: rule.name,
                                startDate: rule.startDate,
                                endDate: rule.endDate,
                                dailyAmount: rule.dailyAmount,
                              })
                            }
                            className="font-semibold text-violet-600 hover:underline dark:text-violet-400"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSeasonalDelete(rule.id)}
                            className="font-semibold text-rose-500 hover:underline dark:text-rose-400"
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                  No seasonal rules yet.
                </p>
              )}

              {canManage &&
              (seasonalForm.editingId || seasonalRules.length < 20) ? (
                <div className="mt-3 grid gap-2">
                  <input
                    type="text"
                    placeholder="Name (e.g. Summer Peak)"
                    value={seasonalForm.name}
                    onChange={(e) =>
                      setSeasonalForm((s) => ({ ...s, name: e.target.value }))
                    }
                    className={inputClass}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={seasonalForm.startDate}
                      onChange={(e) =>
                        setSeasonalForm((s) => ({
                          ...s,
                          startDate: e.target.value,
                        }))
                      }
                      className={inputClass}
                    />
                    <input
                      type="date"
                      value={seasonalForm.endDate}
                      onChange={(e) =>
                        setSeasonalForm((s) => ({
                          ...s,
                          endDate: e.target.value,
                        }))
                      }
                      className={inputClass}
                    />
                  </div>
                  <input
                    type="number"
                    placeholder="Daily amount"
                    min={0}
                    step={0.01}
                    value={seasonalForm.dailyAmount || ""}
                    onChange={(e) =>
                      setSeasonalForm((s) => ({
                        ...s,
                        dailyAmount: Number(e.target.value),
                      }))
                    }
                    className={inputClass}
                  />
                  {seasonalError ? (
                    <p className="text-xs text-rose-600 dark:text-rose-400">
                      {seasonalError}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSeasonalSubmit()}
                      className={primaryButtonClass}
                    >
                      {seasonalForm.editingId ? "Update rule" : "Add rule"}
                    </button>
                    {seasonalForm.editingId ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSeasonalForm({
                            editingId: null,
                            name: "",
                            startDate: "",
                            endDate: "",
                            dailyAmount: 0,
                          })
                        }
                        className={secondaryButtonClass}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }

    if (step.id === "availability") {
      return (
        <div className="grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              label="Availability status"
              value={form.availabilityStatus}
              onChange={(value) =>
                updateField(
                  "availabilityStatus",
                  value as PostingAvailabilityStatus,
                )
              }
              disabled={disabled}
            >
              <option value="available">Available</option>
              <option value="limited">Limited</option>
              <option value="unavailable">Unavailable</option>
            </SelectField>
            <TextField
              label="Availability note"
              value={form.availabilityNotes}
              onChange={(value) => updateField("availabilityNotes", value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <TextField
              label="Max booking days"
              value={form.maxBookingDurationDays}
              onChange={(value) => updateField("maxBookingDurationDays", value)}
              disabled={disabled}
              type="number"
              error={stepErrors.maxBookingDurationDays}
            />
            <TextField
              label="Min booking days"
              value={form.minBookingDurationDays}
              onChange={(value) => updateField("minBookingDurationDays", value)}
              disabled={disabled}
              type="number"
              error={stepErrors.minBookingDurationDays}
            />
            <TextField
              label="Advance notice (days)"
              value={form.advanceNoticeDays}
              onChange={(value) => updateField("advanceNoticeDays", value)}
              disabled={disabled}
              type="number"
              error={stepErrors.advanceNoticeDays}
            />
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <input
              type="checkbox"
              checked={form.instantBooking}
              onChange={(event) =>
                updateField("instantBooking", event.target.checked)
              }
              disabled={disabled}
              className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded accent-violet-600"
            />
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Enable instant booking
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Booking requests are automatically approved — no owner action
                required.
              </p>
            </div>
          </label>
        </div>
      );
    }

    if (step.id === "details") {
      return (
        <div className="grid gap-6">
          <div className="grid gap-2">
            <div>
              <span className={labelText}>
                {humanizeKey(form.family)} attributes
              </span>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Specifics renters care about for a{" "}
                {formatVariantLabel(form.family, form.subtype)}.
              </p>
            </div>
            <DetailsEditor
              details={form.details}
              onChange={(next) => updateField("details", next)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-2">
            <span className={labelText}>Photos</span>
            <PhotoUploader
              photos={photoItems}
              primaryKey={primaryPhotoKey}
              onAddFiles={handleAddFiles}
              onRemove={handleRemovePhoto}
              onSetPrimary={handleSetPrimary}
              disabled={disabled}
              error={stepErrors.photos}
            />
          </div>
        </div>
      );
    }

    // Review
    const reviewSections: Array<{
      title: string;
      step: number;
      summary: string;
    }> = [
      {
        title: "Category",
        step: 0,
        summary: formatVariantLabel(form.family, form.subtype),
      },
      {
        title: "Basics",
        step: 1,
        summary: form.name.trim() || "Untitled listing",
      },
      {
        title: "Location",
        step: 2,
        summary:
          [form.city, form.region]
            .map((v) => v.trim())
            .filter(Boolean)
            .join(", ") || "No location yet",
      },
      {
        title: "Pricing",
        step: 3,
        summary: `${form.dailyPriceAmount || "—"} ${form.currency.toUpperCase()} / day`,
      },
      {
        title: "Availability",
        step: 4,
        summary: `${form.availabilityStatus}${form.instantBooking ? " · Instant book" : ""}`,
      },
      {
        title: "Details & photos",
        step: 5,
        summary: `${Object.keys(form.details).length} attribute${Object.keys(form.details).length === 1 ? "" : "s"} · ${photoItems.length} photo${photoItems.length === 1 ? "" : "s"}`,
      },
    ];

    return (
      <div className="grid gap-5">
        {/* Completeness — compact, checklist tucked away */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Listing completeness
            </p>
            <p className="text-sm font-semibold text-violet-600 dark:text-violet-400">
              {completenessPct}%
            </p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-violet-500 transition-all"
              style={{ width: `${completenessPct}%` }}
            />
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer list-none text-xs font-medium text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
              {completedCount} of {completeness.length} recommendations done ·
              show checklist
            </summary>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {completeness.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
                >
                  <span
                    className={
                      item.done
                        ? "text-emerald-500"
                        : "text-slate-300 dark:text-slate-600"
                    }
                  >
                    {item.done ? "✓" : "○"}
                  </span>
                  {item.label}
                </li>
              ))}
            </ul>
          </details>
        </div>

        {/* Preview beside a compact, clickable section navigator */}
        <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Listing preview
              </p>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                How renters will see it
              </span>
            </div>
            <ListingPreview
              form={form}
              photos={photoItems}
              primaryKey={primaryPhotoKey}
            />
          </div>

          <div className="grid gap-2">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {canManage ? "Review & edit sections" : "Review sections"}
            </p>
            <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
              {reviewSections.map((section) => {
                const valid = isStepValid(section.step);
                return (
                  <button
                    key={section.title}
                    type="button"
                    onClick={() => setCurrentStep(section.step)}
                    className="flex w-full items-center gap-3 border-b border-slate-100 bg-white px-4 py-3 text-left transition last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60"
                  >
                    <span
                      aria-hidden
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        valid
                          ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
                      }`}
                    >
                      {valid ? "✓" : "!"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">
                          {section.title}
                        </span>
                        {!valid ? (
                          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                            Needs attention
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs capitalize text-slate-500 dark:text-slate-400">
                        {section.summary}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-violet-600 dark:text-violet-400">
                      {canManage ? "Edit" : "View"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageShell>
      {/* Org context header */}
      <section className="rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.35)] sm:p-7 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 shadow-sm dark:border-violet-900/60 dark:bg-slate-900 dark:text-violet-300">
              Posting workspace
            </span>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
              {activeOrganization?.name ?? "Organization workspace"}
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Role:{" "}
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {activeOrganization?.role.replaceAll("_", " ")}
              </span>
              {!canManage ? " · read-only access" : null}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/dashboard/organizations" className={secondaryButtonClass}>
              Switch organization
            </Link>
            {canManage && !editorOpen ? (
              <button
                type="button"
                onClick={openNewDraft}
                className={primaryButtonClass}
              >
                Create posting
              </button>
            ) : null}
          </div>
        </div>

        {message ? (
          <div
            role="status"
            className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            {message}
          </div>
        ) : null}
        {error ? (
          <FormErrorMessage
            className="mt-5"
            title="Something went wrong"
            message={error}
          />
        ) : null}
      </section>

      {editorOpen ? (
        <section className="rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.35)] sm:p-7 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
          {/* Stepper */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                {isEditing ? "Edit posting" : "New posting"} · Step{" "}
                {currentStep + 1} of {WIZARD_STEPS.length}
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                {WIZARD_STEPS[currentStep].title}
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {WIZARD_STEPS[currentStep].blurb}
              </p>
            </div>
            <button
              type="button"
              onClick={closeEditor}
              className="text-sm font-semibold text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
            >
              Back to postings
            </button>
          </div>

          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all"
              style={{
                width: `${((currentStep + 1) / WIZARD_STEPS.length) * 100}%`,
              }}
            />
          </div>

          <nav className="mt-4 flex flex-wrap gap-2" aria-label="Posting steps">
            {WIZARD_STEPS.map((step, index) => {
              const reached = index <= maxStepReached;
              const state =
                index === currentStep
                  ? "current"
                  : index < currentStep
                    ? "done"
                    : "upcoming";
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => reached && setCurrentStep(index)}
                  disabled={!reached}
                  aria-current={index === currentStep ? "step" : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    state === "current"
                      ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                      : state === "done"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  } ${reached ? "" : "cursor-not-allowed opacity-50"}`}
                >
                  <span aria-hidden="true">
                    {state === "done" ? "✓" : index + 1}
                  </span>
                  {step.title}
                </button>
              );
            })}
          </nav>

          <div className="mt-6">{renderStepBody()}</div>

          {/* Footer nav */}
          <div className="mt-8 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <button
              type="button"
              onClick={() =>
                currentStep === 0
                  ? closeEditor()
                  : setCurrentStep((step) => step - 1)
              }
              className={secondaryButtonClass}
            >
              {currentStep === 0 ? "Cancel" : "Back"}
            </button>

            {currentStep < REVIEW_STEP ? (
              <div className="flex flex-col items-stretch gap-2 sm:flex-row-reverse sm:items-center">
                <button
                  type="button"
                  onClick={() => {
                    const next = currentStep + 1;
                    setCurrentStep(next);
                    setMaxStepReached((reached) => Math.max(reached, next));
                  }}
                  disabled={!currentStepValid}
                  title={
                    currentStepValid
                      ? undefined
                      : "Complete the required fields on this step to continue."
                  }
                  className={primaryButtonClass}
                >
                  Continue
                </button>
                {!currentStepValid ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <LockIcon />
                    Complete this step to continue
                  </span>
                ) : null}
              </div>
            ) : canManage ? (
              <div className="flex flex-col items-stretch gap-2 sm:flex-row-reverse sm:items-center">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || !canSubmit}
                  title={
                    canSubmit
                      ? undefined
                      : "Complete every step before submitting."
                  }
                  className={primaryButtonClass}
                >
                  {saving
                    ? "Saving..."
                    : isEditing
                      ? "Save changes"
                      : "Create draft"}
                </button>
                {!canSubmit ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <LockIcon />
                    Finish the highlighted steps to submit
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.35)] sm:p-7 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                Active org postings
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                Your listings
              </h2>
            </div>
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {postings.length} total
            </span>
          </div>

          <div className="mt-6 space-y-3">
            {postings.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center dark:border-slate-700">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  No postings yet
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {canManage
                    ? "Create the first listing for this organization."
                    : "Managers haven't created any listings yet."}
                </p>
                {canManage ? (
                  <button
                    type="button"
                    onClick={openNewDraft}
                    className={`${primaryButtonClass} mt-4`}
                  >
                    Create posting
                  </button>
                ) : null}
              </div>
            ) : (
              postings.map((posting) => (
                <article
                  key={posting.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-4 dark:border-slate-800 dark:bg-slate-950/40"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-slate-950 dark:text-white">
                          {posting.name}
                        </h3>
                        <PostingStatusBadge status={posting.status} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {formatVariant(posting)} · {posting.location.city},{" "}
                        {posting.location.region}
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      {formatStatus(posting.status)}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void openPosting(posting.id)}
                      disabled={saving}
                      className={secondaryButtonClass}
                    >
                      {canManage ? "Edit" : "View"}
                    </button>
                    {canManage
                      ? buildLifecycleActions(posting.status).map((action) => (
                          <button
                            key={action.id}
                            type="button"
                            onClick={() =>
                              void handleLifecycleAction(posting.id, action.id)
                            }
                            disabled={saving}
                            className={primaryButtonClass}
                          >
                            {action.label}
                          </button>
                        ))
                      : null}
                  </div>
                </article>
              ))
            )}
          </div>

          {!canManage ? (
            <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
              Operators can inspect org-owned posting details, but only managers
              and primary managers can create or change listings.
            </p>
          ) : null}
        </section>
      )}
    </PageShell>
  );
}

