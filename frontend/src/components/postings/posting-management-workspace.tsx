"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState, type ChangeEvent } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { blobApi } from "@/lib/blob/api";
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
  tags: string;
  availabilityStatus: PostingAvailabilityStatus;
  availabilityNotes: string;
  maxBookingDurationDays: string;
  city: string;
  region: string;
  country: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  detailsJson: string;
  photos: PostingPhotoInput[];
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

function createDefaultDetails(
  family: PostingFamily,
  subtype: string,
): Record<string, unknown> {
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
    tags: "workspace,wifi",
    availabilityStatus: "available",
    availabilityNotes: "",
    maxBookingDurationDays: "14",
    city: "Toronto",
    region: "Ontario",
    country: "Canada",
    postalCode: "",
    latitude: "43.6532",
    longitude: "-79.3832",
    detailsJson: JSON.stringify(
      createDefaultDetails("place", "workspace"),
      null,
      2,
    ),
    photos: [],
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

function toFormState(posting: PostingRecord): PostingFormState {
  return {
    postingId: posting.id,
    family: posting.variant.family,
    subtype: posting.variant.subtype,
    name: posting.name,
    description: posting.description,
    dailyPriceAmount: String(posting.pricing.daily.amount),
    currency: posting.pricing.currency,
    tags: posting.tags.join(", "),
    availabilityStatus: posting.availabilityStatus,
    availabilityNotes: posting.availabilityNotes ?? "",
    maxBookingDurationDays: posting.maxBookingDurationDays
      ? String(posting.maxBookingDurationDays)
      : "",
    city: posting.location.city,
    region: posting.location.region,
    country: posting.location.country,
    postalCode: posting.location.postalCode ?? "",
    latitude: String(posting.location.latitude),
    longitude: String(posting.location.longitude),
    detailsJson: JSON.stringify(posting.details, null, 2),
    photos: posting.photos.map((photo) => ({
      blobUrl: photo.blobUrl,
      blobName: photo.blobName,
      thumbnailBlobUrl: photo.thumbnailBlobUrl,
      thumbnailBlobName: photo.thumbnailBlobName,
      position: photo.position,
    })),
  };
}

function buildPayload(form: PostingFormState): UpsertPostingInput {
  let details: Record<string, PostingDetailValue>;

  try {
    details = JSON.parse(form.detailsJson) as Record<
      string,
      PostingDetailValue
    >;
  } catch {
    throw new Error("Details JSON must be valid before saving.");
  }

  if (form.photos.length === 0) {
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
    photos: form.photos,
    tags: form.tags
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    details,
    availabilityStatus: form.availabilityStatus,
    availabilityNotes: form.availabilityNotes.trim() || null,
    maxBookingDurationDays: form.maxBookingDurationDays.trim()
      ? Number(form.maxBookingDurationDays)
      : null,
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

export function PostingManagementWorkspace() {
  const router = useRouter();
  const { status, session } = useAuth();
  const [postings, setPostings] = useState<PostingRecord[]>([]);
  const [form, setForm] = useState<PostingFormState>(createDefaultFormState());
  const [selectedPostingId, setSelectedPostingId] = useState<string | null>(
    null,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
        const result = await postingsApi.listMine();

        if (!active) {
          return;
        }

        startTransition(() => {
          setPostings(result.postings);
          setSelectedPostingId(result.postings[0]?.id ?? null);
        });
      } catch (nextError) {
        if (active) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Posting management could not be loaded.",
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

  const activeOrganization = session?.user.activeOrganization;
  const canRead = canReadOrganizationPostings(activeOrganization);
  const canManage = canManageOrganizationPostings(activeOrganization);

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

    startTransition(() => {
      setSelectedPostingId(postingId);
      setForm(toFormState(nextPosting));
      setSelectedFile(null);
    });
  }

  async function handleSave() {
    if (!canManage) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      let nextPhotos = form.photos;

      if (selectedFile) {
        nextPhotos = [await uploadManagedPhoto(selectedFile)];
      }

      const payload = buildPayload({
        ...form,
        photos: nextPhotos,
      });
      const saved = form.postingId
        ? await postingsApi.update(form.postingId, payload)
        : await postingsApi.create(payload);

      await refresh(saved.id);
      setMessage(
        form.postingId
          ? "Posting updated for your active organization."
          : "Draft created for your active organization.",
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Posting could not be saved.",
      );
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
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Posting lifecycle action failed.",
      );
    } finally {
      setSaving(false);
    }
  }

  function handleNewDraft() {
    setSelectedPostingId(null);
    setSelectedFile(null);
    setMessage(null);
    setError(null);
    setForm(createDefaultFormState());
  }

  function handleFamilyChange(family: PostingFamily) {
    const nextSubtype = subtypeOptionsByFamily[family][0]?.value ?? "workspace";

    setForm((current) => ({
      ...current,
      family,
      subtype: nextSubtype,
      detailsJson: JSON.stringify(
        createDefaultDetails(family, nextSubtype),
        null,
        2,
      ),
    }));
  }

  function handleSubtypeChange(subtype: string) {
    setForm((current) => ({
      ...current,
      subtype,
      detailsJson: JSON.stringify(
        createDefaultDetails(current.family, subtype),
        null,
        2,
      ),
    }));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFile(event.target.files?.[0] ?? null);
  }

  if (status === "loading" || loading) {
    return (
      <main className="min-h-[calc(100vh-5.5rem)] bg-slate-50 px-6 py-12 text-slate-900">
        <div className="mx-auto max-w-6xl text-sm font-medium text-slate-500">
          Loading posting workspace...
        </div>
      </main>
    );
  }

  if (status !== "authenticated" || !session) {
    return null;
  }

  if (!canRead) {
    return (
      <main className="min-h-[calc(100vh-5.5rem)] bg-slate-50 px-6 py-12 text-slate-900">
        <div className="mx-auto max-w-4xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
            Posting workspace
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
            Select an organization first
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
            Posting management now follows your active organization. Switch into
            an organization workspace first, then come back here to manage its
            postings.
          </p>
          <Link
            href="/organizations"
            className="mt-6 inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
          >
            Open organizations
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-5.5rem)] bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-600">
                Active organization
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-slate-950">
                {activeOrganization?.name ?? "Organization workspace"}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                Create drafts, edit listing content, and run publish or pause
                actions inside your active organization. Legacy owner analytics
                and payouts still live in the owner dashboard for now.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Role:{" "}
              <span className="font-semibold text-slate-900">
                {activeOrganization?.role.replaceAll("_", " ")}
              </span>
              {!canManage ? (
                <p className="mt-2 text-xs text-slate-500">
                  Read-only access. Managers can create and change postings.
                </p>
              ) : null}
            </div>
          </div>
          {message ? (
            <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
                  {form.postingId ? "Edit posting" : "Create draft"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  The form keeps variant details in JSON so managers can edit
                  any seeded posting type without a separate editor for each
                  family.
                </p>
              </div>
              {canManage ? (
                <button
                  type="button"
                  onClick={handleNewDraft}
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  New draft
                </button>
              ) : null}
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Family</span>
                <select
                  value={form.family}
                  onChange={(event) =>
                    handleFamilyChange(event.target.value as PostingFamily)
                  }
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900"
                >
                  <option value="place">Place</option>
                  <option value="equipment">Equipment</option>
                  <option value="vehicle">Vehicle</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Subtype</span>
                <select
                  value={form.subtype}
                  onChange={(event) => handleSubtypeChange(event.target.value)}
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900"
                >
                  {subtypeOptionsByFamily[form.family].map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-4">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Name</span>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900"
                  placeholder="Downtown creative studio"
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Description</span>
                <textarea
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  disabled={!canManage || saving}
                  className="min-h-32 rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Daily price</span>
                <input
                  value={form.dailyPriceAmount}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dailyPriceAmount: event.target.value,
                    }))
                  }
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900"
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Currency</span>
                <input
                  value={form.currency}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      currency: event.target.value,
                    }))
                  }
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900"
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Tags</span>
                <input
                  value={form.tags}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      tags: event.target.value,
                    }))
                  }
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900"
                  placeholder="workspace, wifi"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Availability</span>
                <select
                  value={form.availabilityStatus}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      availabilityStatus: event.target
                        .value as PostingAvailabilityStatus,
                    }))
                  }
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900"
                >
                  <option value="available">Available</option>
                  <option value="limited">Limited</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm sm:col-span-2">
                <span className="font-medium text-slate-700">
                  Availability note
                </span>
                <input
                  value={form.availabilityNotes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      availabilityNotes: event.target.value,
                    }))
                  }
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["City", "city"],
                ["Region", "region"],
                ["Country", "country"],
                ["Postal code", "postalCode"],
              ].map(([label, key]) => (
                <label key={key} className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">{label}</span>
                  <input
                    value={form[key as keyof PostingFormState] as string}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    disabled={!canManage || saving}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900"
                  />
                </label>
              ))}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {[
                ["Latitude", "latitude"],
                ["Longitude", "longitude"],
                ["Max booking days", "maxBookingDurationDays"],
              ].map(([label, key]) => (
                <label key={key} className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">{label}</span>
                  <input
                    value={form[key as keyof PostingFormState] as string}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    disabled={!canManage || saving}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900"
                  />
                </label>
              ))}
            </div>

            <label className="mt-4 grid gap-2 text-sm">
              <span className="font-medium text-slate-700">
                Variant details JSON
              </span>
              <textarea
                value={form.detailsJson}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    detailsJson: event.target.value,
                  }))
                }
                disabled={!canManage || saving}
                className="min-h-48 rounded-3xl border border-slate-200 bg-slate-950 px-4 py-3 font-mono text-sm text-slate-50"
              />
            </label>

            <label className="mt-4 grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Primary photo</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                disabled={!canManage || saving}
                className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-slate-700"
              />
              <span className="text-xs text-slate-500">
                {selectedFile
                  ? `Ready to upload ${selectedFile.name}.`
                  : form.photos[0]
                    ? "Existing managed photo will be reused until you upload a new one."
                    : "Upload one image so the draft can be saved."}
              </span>
            </label>

            {canManage ? (
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving
                    ? "Saving..."
                    : form.postingId
                      ? "Save changes"
                      : "Create draft"}
                </button>
                <Link
                  href="/organizations"
                  className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Switch organization
                </Link>
              </div>
            ) : (
              <p className="mt-6 text-sm text-slate-500">
                Operators can inspect org-owned posting details here, but only
                managers and primary managers can save or change listing state.
              </p>
            )}
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
                  Active org postings
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  `/postings/me` now follows the active organization rather than
                  direct user ownership.
                </p>
              </div>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                {postings.length} loaded
              </span>
            </div>

            <div className="mt-6 space-y-4">
              {postings.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-sm text-slate-500">
                  No postings found for the active organization yet.
                </div>
              ) : null}
              {postings.map((posting) => (
                <article
                  key={posting.id}
                  className={`rounded-3xl border px-5 py-4 transition ${
                    posting.id === selectedPostingId
                      ? "border-amber-300 bg-amber-50/60"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950">
                        {posting.name}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {formatVariant(posting)} · {posting.location.city},{" "}
                        {posting.location.region}
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                      {formatStatus(posting.status)}
                    </span>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {posting.description}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSelectPosting(posting.id)}
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
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
                            className="rounded-full bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {action.label}
                          </button>
                        ))
                      : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
