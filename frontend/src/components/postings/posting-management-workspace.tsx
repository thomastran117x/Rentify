"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState, type ChangeEvent } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { FormErrorMessage, useErrorModal } from "@/components/errors";
import { blobApi } from "@/lib/blob/api";
import { getApiErrorMessage } from "@/lib/api/user-messages";
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
  tags: string;
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
): Array<{ label: string; done: boolean }> {
  const tags = form.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  return [
    { label: "Description (100+ chars)", done: form.description.length >= 100 },
    { label: "At least 3 photos", done: form.photos.length >= 3 },
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

export function PostingManagementWorkspace() {
  const router = useRouter();
  const { status, session } = useAuth();
  const { showErrorModal } = useErrorModal();
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

  const activeOrganization = session?.user.activeOrganization;
  const canRead = canReadOrganizationPostings(activeOrganization);
  const canManage = canManageOrganizationPostings(activeOrganization);
  const selectedPosting =
    postings.find((p) => p.id === selectedPostingId) ?? null;

  async function savePostingRequest() {
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

    startTransition(() => {
      setSelectedPostingId(postingId);
      setForm(toFormState(nextPosting));
      setSelectedFile(null);
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
      const message = getApiErrorMessage(nextError, {
        action: "save this posting",
        fallback: "We couldn't save this posting right now. Please try again.",
        preserveUnknownErrorMessage: true,
      });

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

  function handleNewDraft() {
    setSelectedPostingId(null);
    setSelectedFile(null);
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
      <main className="min-h-[calc(100vh-5.5rem)] bg-slate-50 dark:bg-slate-900 px-6 py-12 text-slate-900 dark:text-white">
        <div className="mx-auto max-w-6xl text-sm font-medium text-slate-500 dark:text-slate-400">
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
      <main className="min-h-[calc(100vh-5.5rem)] bg-slate-50 dark:bg-slate-900 px-6 py-12 text-slate-900 dark:text-white">
        <div className="mx-auto max-w-4xl rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            Posting workspace
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
            Select an organization first
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
            Posting management now follows your active organization. Switch into
            an organization workspace first, then come back here to manage its
            postings.
          </p>
          <Link
            href="/organizations"
            className="mt-6 inline-flex rounded-full bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-4 py-2 text-sm font-semibold text-white"
          >
            Open organizations
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-5.5rem)] bg-slate-50 dark:bg-slate-900 px-6 py-10 text-slate-900 dark:text-white">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-600">
                Active organization
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">
                {activeOrganization?.name ?? "Organization workspace"}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300">
                Create drafts, edit listing content, and run publish or pause
                actions inside your active organization. Legacy owner analytics
                and payouts still live in the owner dashboard for now.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
              Role:{" "}
              <span className="font-semibold text-slate-900 dark:text-white">
                {activeOrganization?.role.replaceAll("_", " ")}
              </span>
              {!canManage ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Read-only access. Managers can create and change postings.
                </p>
              ) : null}
            </div>
          </div>
          {message ? (
            <p className="mt-5 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
              {message}
            </p>
          ) : null}
          {error ? (
            <FormErrorMessage
              className="mt-5"
              title="Couldn't load posting workspace"
              message={error}
            />
          ) : null}
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
          <div className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                  {form.postingId ? "Edit posting" : "Create draft"}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  The form keeps variant details in JSON so managers can edit
                  any seeded posting type without a separate editor for each
                  family.
                </p>
              </div>
              {canManage ? (
                <button
                  type="button"
                  onClick={handleNewDraft}
                  className="rounded-full border border-slate-200 dark:border-slate-800 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  New draft
                </button>
              ) : null}
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Family
                </span>
                <select
                  value={form.family}
                  onChange={(event) =>
                    handleFamilyChange(event.target.value as PostingFamily)
                  }
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-white"
                >
                  <option value="place">Place</option>
                  <option value="equipment">Equipment</option>
                  <option value="vehicle">Vehicle</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Subtype
                </span>
                <select
                  value={form.subtype}
                  onChange={(event) => handleSubtypeChange(event.target.value)}
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-white"
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
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Name
                </span>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-white"
                  placeholder="Downtown creative studio"
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Description
                </span>
                <textarea
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  disabled={!canManage || saving}
                  className="min-h-32 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-white"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Daily price
                </span>
                <input
                  value={form.dailyPriceAmount}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dailyPriceAmount: event.target.value,
                    }))
                  }
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-white"
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Currency
                </span>
                <input
                  value={form.currency}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      currency: event.target.value,
                    }))
                  }
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-white"
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Tags
                </span>
                <input
                  value={form.tags}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      tags: event.target.value,
                    }))
                  }
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-white"
                  placeholder="workspace, wifi"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Availability
                </span>
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
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-white"
                >
                  <option value="available">Available</option>
                  <option value="limited">Limited</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm sm:col-span-2">
                <span className="font-medium text-slate-700 dark:text-slate-200">
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
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-white"
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
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {label}
                  </span>
                  <input
                    value={form[key as keyof PostingFormState] as string}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    disabled={!canManage || saving}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-white"
                  />
                </label>
              ))}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {[
                ["Latitude", "latitude"],
                ["Longitude", "longitude"],
                ["Max booking days", "maxBookingDurationDays"],
                ["Min booking days", "minBookingDurationDays"],
                ["Advance notice (days)", "advanceNoticeDays"],
              ].map(([label, key]) => (
                <label key={key} className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {label}
                  </span>
                  <input
                    value={form[key as keyof PostingFormState] as string}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    disabled={!canManage || saving}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-white"
                  />
                </label>
              ))}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Cancellation policy
                </span>
                <select
                  value={form.cancellationPolicy}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      cancellationPolicy: event.target.value,
                    }))
                  }
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-white"
                >
                  <option value="">Not specified</option>
                  <option value="flexible">Flexible</option>
                  <option value="moderate">Moderate</option>
                  <option value="strict">Strict</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm sm:col-span-2">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Cancellation policy notes
                </span>
                <input
                  value={form.cancellationPolicyNotes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      cancellationPolicyNotes: event.target.value,
                    }))
                  }
                  disabled={!canManage || saving}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-white"
                />
              </label>
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
              <input
                type="checkbox"
                checked={form.instantBooking}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    instantBooking: event.target.checked,
                  }))
                }
                disabled={!canManage || saving}
                className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded accent-sky-600"
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

            {selectedPostingId ? (
              <div className="mt-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Seasonal Pricing
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Override the daily rate for specific date ranges (e.g.
                  holidays, peak season).
                </p>

                {seasonalRules.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {seasonalRules.map((rule) => (
                      <li
                        key={rule.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-700 dark:text-slate-200"
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
                              className="text-sky-600 dark:text-sky-400 hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSeasonalDelete(rule.id)}
                              className="text-rose-500 dark:text-rose-400 hover:underline"
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
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      {seasonalForm.editingId ? "Edit rule" : "Add rule"}
                    </p>
                    <input
                      type="text"
                      placeholder="Name (e.g. Summer Peak)"
                      value={seasonalForm.name}
                      onChange={(e) =>
                        setSeasonalForm((s) => ({ ...s, name: e.target.value }))
                      }
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
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
                        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
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
                        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
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
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
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
                        className="rounded-full bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                      >
                        {seasonalForm.editingId ? "Update" : "Add"}
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
                          className="rounded-full border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <label className="mt-4 grid gap-2 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">
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
                className="min-h-48 rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-4 py-3 font-mono text-sm text-slate-50"
              />
            </label>

            <label className="mt-4 grid gap-2 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Primary photo
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                disabled={!canManage || saving}
                className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-slate-700 dark:text-slate-200"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {selectedFile
                  ? `Ready to upload ${selectedFile.name}.`
                  : form.photos[0]
                    ? "Existing managed photo will be reused until you upload a new one."
                    : "Upload one image so the draft can be saved."}
              </span>
            </label>

            {canManage &&
            (!selectedPosting || selectedPosting.status === "draft")
              ? (() => {
                  const items = getCompletenessItems(form);
                  const done = items.filter((i) => i.done).length;
                  const pct = Math.round((done / items.length) * 100);
                  return (
                    <div className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                          Listing completeness
                        </p>
                        <p className="text-sm font-medium text-sky-600 dark:text-sky-400">
                          {pct}%
                        </p>
                      </div>
                      <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-sky-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <ul className="space-y-1">
                        {items.map((item) => (
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
                    </div>
                  );
                })()
              : null}

            {canManage ? (
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="rounded-full bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving
                    ? "Saving..."
                    : form.postingId
                      ? "Save changes"
                      : "Create draft"}
                </button>
                <Link
                  href="/organizations"
                  className="rounded-full border border-slate-200 dark:border-slate-800 px-5 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Switch organization
                </Link>
              </div>
            ) : (
              <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
                Operators can inspect org-owned posting details here, but only
                managers and primary managers can save or change listing state.
              </p>
            )}
          </div>

          <div className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                  Active org postings
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  `/postings/me` now follows the active organization rather than
                  direct user ownership.
                </p>
              </div>
              <span className="rounded-full bg-amber-50 dark:bg-amber-950/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
                {postings.length} loaded
              </span>
            </div>

            <div className="mt-6 space-y-4">
              {postings.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-5 py-8 text-sm text-slate-500 dark:text-slate-400">
                  No postings found for the active organization yet.
                </div>
              ) : null}
              {postings.map((posting) => (
                <article
                  key={posting.id}
                  className={`rounded-3xl border px-5 py-4 transition ${
                    posting.id === selectedPostingId
                      ? "border-amber-300 dark:border-amber-800 bg-amber-50/60"
                      : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                        {posting.name}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {formatVariant(posting)} · {posting.location.city},{" "}
                        {posting.location.region}
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 dark:border-slate-800 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">
                      {formatStatus(posting.status)}
                    </span>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {posting.description}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSelectPosting(posting.id)}
                      className="rounded-full border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800"
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
                            className="rounded-full bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
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
