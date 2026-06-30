import { z } from "zod";
import {
  EQUIPMENT_POSTING_SUBTYPE_VALUES,
  POSTING_FAMILY_VALUES,
  POSTING_SUBTYPE_VALUES,
  PLACE_POSTING_SUBTYPE_VALUES,
  type PostingAttributeValue as VariantPostingAttributeValue,
  VEHICLE_POSTING_SUBTYPE_VALUES,
} from "@/features/postings/postings.variants";

export const MAX_POSTING_PHOTOS = 10;
export const MAX_BATCH_IDS = 50;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const MAX_SEARCH_RESULT_WINDOW = 10_000;
export const DEFAULT_MAX_BOOKING_DURATION_DAYS = 30;
export const MAX_BOOKING_DURATION_DAYS_LIMIT = 365;
export const MIN_BOOKING_DURATION_DAYS_LIMIT = 365;
export const MAX_ADVANCE_NOTICE_DAYS_LIMIT = 365;

export const postingCancellationPolicySchema = z.enum([
  "flexible",
  "moderate",
  "strict",
]);

export const postingStatusSchema = z.enum([
  "draft",
  "published",
  "paused",
  "archived",
]);
export const postingAvailabilityStatusSchema = z.enum([
  "available",
  "limited",
  "unavailable",
]);
export const postingFamilySchema = z.enum(POSTING_FAMILY_VALUES);
export const postingSubtypeSchema = z.enum(POSTING_SUBTYPE_VALUES);
export const postingSearchSourceSchema = z.enum(["elasticsearch", "database"]);
export const postingAutocompleteSuggestionKindSchema = z.enum([
  "name",
  "tag",
  "location",
]);
export const postingSortSchema = z.enum([
  "relevance",
  "newest",
  "oldest",
  "dailyPrice",
  "nearest",
  "nameAsc",
  "nameDesc",
]);

const trimmedStringSchema = z.string().trim().min(1);
const SAFE_DETAIL_KEY_PATTERN = /^[a-z][a-z0-9_]*$/i;
const SAFE_RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const RESERVED_DETAIL_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const postingTagSchema = trimmedStringSchema
  .max(50)
  .refine((value) => !value.includes(","), {
    message: "Tags cannot contain commas.",
  });
const nullableTrimmedStringSchema = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .optional();

const moneyAmountSchema = z
  .number()
  .finite("Amount must be a valid number.")
  .positive("Amount must be greater than zero.");

const pricingRateSchema = z.object({
  amount: moneyAmountSchema,
});

export const postingPricingSchema = z.object({
  currency: z
    .string()
    .trim()
    .length(3, "Currency must be a 3-letter ISO code.")
    .transform((value) => value.toUpperCase()),
  daily: pricingRateSchema,
  hourly: pricingRateSchema.optional(),
  weekly: pricingRateSchema.optional(),
  monthly: pricingRateSchema.optional(),
});

const detailStringSchema = trimmedStringSchema.max(100);
const detailStringArraySchema = z
  .array(detailStringSchema)
  .max(20)
  .transform((values) => Array.from(new Set(values)));
const searchAttributeStringArraySchema = z
  .array(detailStringSchema)
  .min(1)
  .max(20)
  .transform((values) => Array.from(new Set(values)));
const detailCatchallSchema = z.union([
  detailStringSchema,
  z.number().finite(),
  z.boolean(),
  detailStringArraySchema,
]);

function validateDetailKeys(
  details: Record<string, unknown>,
  context: z.RefinementCtx,
): void {
  for (const key of Object.keys(details)) {
    if (RESERVED_DETAIL_KEYS.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: "Reserved detail keys are not allowed.",
      });
      continue;
    }

    if (key.length > 50 || !SAFE_DETAIL_KEY_PATTERN.test(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message:
          "Detail keys must start with a letter and contain only letters, numbers, and underscores.",
      });
    }
  }
}

export const placePostingSubtypeSchema = z.enum(PLACE_POSTING_SUBTYPE_VALUES);
export const equipmentPostingSubtypeSchema = z.enum(
  EQUIPMENT_POSTING_SUBTYPE_VALUES,
);
export const vehiclePostingSubtypeSchema = z.enum(
  VEHICLE_POSTING_SUBTYPE_VALUES,
);

export const placePostingVariantSchema = z.object({
  family: z.literal("place"),
  subtype: placePostingSubtypeSchema,
});

export const equipmentPostingVariantSchema = z.object({
  family: z.literal("equipment"),
  subtype: equipmentPostingSubtypeSchema,
});

export const vehiclePostingVariantSchema = z.object({
  family: z.literal("vehicle"),
  subtype: vehiclePostingSubtypeSchema,
});

export const postingVariantSchema = z.union([
  placePostingVariantSchema,
  equipmentPostingVariantSchema,
  vehiclePostingVariantSchema,
]);

export const placePostingDetailsSchema = z
  .object({
    guest_capacity: z.number().int().min(1).max(1000),
    bedrooms: z.number().int().min(0).max(1000).optional(),
    bathrooms: z.number().min(0).max(1000).optional(),
    property_type: detailStringSchema,
    amenities: detailStringArraySchema.default([]),
    pet_friendly: z.boolean().optional(),
    parking: z.boolean().optional(),
  })
  .catchall(detailCatchallSchema)
  .superRefine(validateDetailKeys);

export const equipmentPostingDetailsSchema = z
  .object({
    condition: detailStringSchema,
    brand: detailStringSchema.optional(),
    model: detailStringSchema.optional(),
    power_source: detailStringSchema.optional(),
    weight_lb: z.number().finite().min(0).optional(),
    includes_delivery: z.boolean().optional(),
  })
  .catchall(detailCatchallSchema)
  .superRefine(validateDetailKeys);

export const vehiclePostingDetailsSchema = z
  .object({
    make: detailStringSchema,
    model: detailStringSchema,
    year: z.number().int().min(1886).max(9999),
    seats: z.number().int().min(1).max(200),
    license_class: detailStringSchema,
    transmission: detailStringSchema.optional(),
    fuel_type: detailStringSchema.optional(),
  })
  .catchall(detailCatchallSchema)
  .superRefine(validateDetailKeys);

export const postingResourceIdSchema = trimmedStringSchema
  .max(64)
  .regex(SAFE_RESOURCE_ID_PATTERN, {
    message:
      "Identifiers must contain only letters, numbers, underscores, and hyphens.",
  });

export const searchAttributeFilterKeySchema = trimmedStringSchema
  .max(50)
  .regex(SAFE_DETAIL_KEY_PATTERN, {
    message:
      "Attribute keys must start with a letter and contain only letters, numbers, and underscores.",
  });

const searchAttributeFilterValueSchema = z.union([
  detailStringSchema,
  z.number().finite(),
  z.boolean(),
  searchAttributeStringArraySchema,
]);

export const searchAttributeFilterSchema = z
  .object({
    key: searchAttributeFilterKeySchema,
    value: searchAttributeFilterValueSchema.optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .superRefine((filter, context) => {
    if (
      filter.value === undefined &&
      filter.min === undefined &&
      filter.max === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Attribute filters require a value or min/max range.",
      });
    }

    if (
      filter.min !== undefined &&
      filter.max !== undefined &&
      filter.min > filter.max
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["min"],
        message: "Attribute minimum cannot exceed attribute maximum.",
      });
    }
  });

export const searchAttributeFiltersSchema = z
  .array(searchAttributeFilterSchema)
  .max(20);

export const postingBatchIdsQuerySchema = z
  .array(postingResourceIdSchema)
  .min(1)
  .max(MAX_BATCH_IDS)
  .transform((ids) => Array.from(new Set(ids)));

export const postingPhotoSchema = z.object({
  blobUrl: z.url("Photo URL must be a valid URL."),
  blobName: trimmedStringSchema.max(1024),
  position: z
    .number()
    .int()
    .min(0)
    .max(MAX_POSTING_PHOTOS - 1),
});

export const postingAvailabilityBlockSchema = z.object({
  startAt: z
    .string()
    .datetime("Availability block start time must be an ISO datetime."),
  endAt: z
    .string()
    .datetime("Availability block end time must be an ISO datetime."),
  note: nullableTrimmedStringSchema.pipe(
    z.string().trim().max(255).nullable().optional(),
  ),
});

const sharedUpsertPostingRequestShape = {
  name: trimmedStringSchema.max(150),
  description: trimmedStringSchema.max(5000),
  pricing: postingPricingSchema,
  photos: z.array(postingPhotoSchema).min(1).max(MAX_POSTING_PHOTOS),
  tags: z.array(postingTagSchema).max(30).default([]),
  availabilityStatus: postingAvailabilityStatusSchema,
  availabilityNotes: nullableTrimmedStringSchema.pipe(
    z.string().trim().max(500).nullable().optional(),
  ),
  maxBookingDurationDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_BOOKING_DURATION_DAYS_LIMIT)
    .nullable()
    .optional(),
  minBookingDurationDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(MIN_BOOKING_DURATION_DAYS_LIMIT)
    .nullable()
    .optional(),
  advanceNoticeDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_ADVANCE_NOTICE_DAYS_LIMIT)
    .nullable()
    .optional(),
  cancellationPolicy: postingCancellationPolicySchema.nullable().optional(),
  cancellationPolicyNotes: nullableTrimmedStringSchema.pipe(
    z.string().trim().max(500).nullable().optional(),
  ),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    city: trimmedStringSchema.max(120),
    region: trimmedStringSchema.max(120),
    country: trimmedStringSchema.max(120),
    postalCode: nullableTrimmedStringSchema.pipe(
      z.string().trim().max(32).nullable().optional(),
    ),
  }),
};

export const placeUpsertPostingRequestSchema = z
  .object({
    ...sharedUpsertPostingRequestShape,
    variant: placePostingVariantSchema,
    details: placePostingDetailsSchema,
    availabilityBlocks: z
      .array(postingAvailabilityBlockSchema)
      .max(200)
      .default([]),
  })
  .strict();

export const equipmentUpsertPostingRequestSchema = z
  .object({
    ...sharedUpsertPostingRequestShape,
    variant: equipmentPostingVariantSchema,
    details: equipmentPostingDetailsSchema,
    availabilityBlocks: z
      .array(postingAvailabilityBlockSchema)
      .max(200)
      .default([]),
  })
  .strict();

export const vehicleUpsertPostingRequestSchema = z
  .object({
    ...sharedUpsertPostingRequestShape,
    variant: vehiclePostingVariantSchema,
    details: vehiclePostingDetailsSchema,
    availabilityBlocks: z
      .array(postingAvailabilityBlockSchema)
      .max(200)
      .default([]),
  })
  .strict();

export const upsertPostingRequestSchema = z.union([
  placeUpsertPostingRequestSchema,
  equipmentUpsertPostingRequestSchema,
  vehicleUpsertPostingRequestSchema,
]);

export const placeUpdatePostingRequestSchema = z
  .object({
    ...sharedUpsertPostingRequestShape,
    variant: placePostingVariantSchema,
    details: placePostingDetailsSchema,
  })
  .strict();

export const equipmentUpdatePostingRequestSchema = z
  .object({
    ...sharedUpsertPostingRequestShape,
    variant: equipmentPostingVariantSchema,
    details: equipmentPostingDetailsSchema,
  })
  .strict();

export const vehicleUpdatePostingRequestSchema = z
  .object({
    ...sharedUpsertPostingRequestShape,
    variant: vehiclePostingVariantSchema,
    details: vehiclePostingDetailsSchema,
  })
  .strict();

export const updatePostingRequestSchema = z.union([
  placeUpdatePostingRequestSchema,
  equipmentUpdatePostingRequestSchema,
  vehicleUpdatePostingRequestSchema,
]);

export const ownerAvailabilityBlockRequestSchema =
  postingAvailabilityBlockSchema;

export const listOwnerPostingsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
    status: postingStatusSchema.optional(),
  })
  .strict();

export const publicSearchPostingsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
    q: z.string().trim().min(1).max(120).optional(),
    family: postingFamilySchema.optional(),
    subtype: postingSubtypeSchema.optional(),
    tags: z.array(postingTagSchema).max(20).optional(),
    availabilityStatus: postingAvailabilityStatusSchema.optional(),
    minDailyPrice: z.coerce.number().finite().nonnegative().optional(),
    maxDailyPrice: z.coerce.number().finite().nonnegative().optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().positive().max(20_000).optional(),
    startAt: z
      .string()
      .datetime("Search start time must be an ISO datetime.")
      .optional(),
    endAt: z
      .string()
      .datetime("Search end time must be an ISO datetime.")
      .optional(),
    sort: postingSortSchema.default("relevance"),
  })
  .strict()
  .superRefine((query, context) => {
    if ((query.startAt === undefined) !== (query.endAt === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startAt"],
        message: "startAt and endAt must be provided together.",
      });
    }

    const hasLatitude = query.latitude !== undefined;
    const hasLongitude = query.longitude !== undefined;

    if (hasLatitude !== hasLongitude) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latitude"],
        message: "latitude and longitude must be provided together.",
      });
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["longitude"],
        message: "latitude and longitude must be provided together.",
      });
    }

    if (query.radiusKm !== undefined && (!hasLatitude || !hasLongitude)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["radiusKm"],
        message: "radiusKm requires both latitude and longitude.",
      });
    }
  });

export const publicAutocompletePostingsQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(120),
    family: postingFamilySchema.optional(),
    subtype: postingSubtypeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(8).default(6),
  })
  .strict();

export type PostingStatus = z.infer<typeof postingStatusSchema>;
export type PostingAvailabilityStatus = z.infer<
  typeof postingAvailabilityStatusSchema
>;
export type PostingCancellationPolicy = z.infer<
  typeof postingCancellationPolicySchema
>;
export type PostingFamily = z.infer<typeof postingFamilySchema>;
export type PostingSubtype = z.infer<typeof postingSubtypeSchema>;
export type PostingSearchSource = z.infer<typeof postingSearchSourceSchema>;
export type PostingAutocompleteSuggestionKind = z.infer<
  typeof postingAutocompleteSuggestionKindSchema
>;
export type PostingSort = z.infer<typeof postingSortSchema>;
export type PostingPricing = z.infer<typeof postingPricingSchema>;
export interface PostingVariant {
  family: PostingFamily;
  subtype: PostingSubtype;
}
export type PostingAttributeValue = VariantPostingAttributeValue;
export type PlacePostingDetails = z.infer<typeof placePostingDetailsSchema>;
export type EquipmentPostingDetails = z.infer<
  typeof equipmentPostingDetailsSchema
>;
export type VehiclePostingDetails = z.infer<typeof vehiclePostingDetailsSchema>;
export type PostingDetails =
  | PlacePostingDetails
  | EquipmentPostingDetails
  | VehiclePostingDetails;
export type PostingPhotoInput = z.infer<typeof postingPhotoSchema>;
export interface ManagedPostingPhotoInput extends PostingPhotoInput {
  thumbnailBlobUrl?: string;
  thumbnailBlobName?: string;
}
export type PostingAvailabilityBlockInput = z.infer<
  typeof postingAvailabilityBlockSchema
>;
export type UpsertPostingRequestBody = z.infer<
  typeof upsertPostingRequestSchema
>;
export type UpdatePostingRequestBody = z.infer<
  typeof updatePostingRequestSchema
>;
export type OwnerAvailabilityBlockRequestBody = z.infer<
  typeof ownerAvailabilityBlockRequestSchema
>;
export type ListOwnerPostingsQuery = z.infer<
  typeof listOwnerPostingsQuerySchema
>;
export type PublicSearchPostingsQuery = z.infer<
  typeof publicSearchPostingsQuerySchema
>;
export type PublicAutocompletePostingsQuery = z.infer<
  typeof publicAutocompletePostingsQuerySchema
>;

export interface SearchAttributeFilterInput {
  key: string;
  value?: string | number | boolean | string[];
  min?: number;
  max?: number;
}

export interface PostingPhotoRecord {
  id: string;
  blobUrl: string;
  blobName: string;
  thumbnailBlobUrl?: string;
  thumbnailBlobName?: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface PostingAvailabilityBlockRecord {
  id: string;
  startAt: string;
  endAt: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PostingLocationRecord {
  city: string;
  region: string;
  country: string;
  postalCode?: string;
  latitude: number;
  longitude: number;
}

export interface PublicPostingLocationRecord {
  city: string;
  region: string;
  country: string;
  postalCode?: string;
  latitude: number;
  longitude: number;
}

export interface PostingViewerReviewState {
  eligible: boolean;
  hasOwnReview: boolean;
}

export interface PublicPostingOrganizationSummary {
  id: string;
  name: string;
}

export interface PostingRecord {
  id: string;
  organizationId: string;
  status: PostingStatus;
  variant: PostingVariant;
  name: string;
  description: string;
  pricing: PostingPricing;
  pricingCurrency: string;
  photos: PostingPhotoRecord[];
  tags: string[];
  details: PostingDetails;
  availabilityStatus: PostingAvailabilityStatus;
  availabilityNotes?: string;
  maxBookingDurationDays?: number;
  minBookingDurationDays?: number;
  advanceNoticeDays?: number;
  cancellationPolicy?: PostingCancellationPolicy;
  cancellationPolicyNotes?: string;
  effectiveMaxBookingDurationDays: number;
  availabilityBlocks: PostingAvailabilityBlockRecord[];
  location: PostingLocationRecord;
  publishedAt?: string;
  pausedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicPostingRecord
  extends Omit<PostingRecord, "location" | "organizationId"> {
  location: PublicPostingLocationRecord;
  organization?: PublicPostingOrganizationSummary;
  primaryPhotoUrl?: string;
  primaryThumbnailUrl?: string;
  viewerReviewState?: PostingViewerReviewState;
}

export interface PostingPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ListOwnerPostingsResult {
  postings: PostingRecord[];
  pagination: PostingPagination;
  status?: PostingStatus;
}

export interface BatchPostingsResult<TRecord> {
  postings: TRecord[];
  missingIds: string[];
}

export interface SearchPostingsResult {
  postings: PublicPostingRecord[];
  pagination: PostingPagination;
  source: PostingSearchSource;
  query?: string;
}

export interface PostingAutocompleteSuggestion {
  value: string;
  kind: PostingAutocompleteSuggestionKind;
}

export interface PostingAutocompleteInput {
  query: string;
  family?: PostingFamily;
  subtype?: PostingSubtype;
  limit: number;
}

export interface PostingAutocompleteResult {
  query: string;
  suggestions: PostingAutocompleteSuggestion[];
  source: PostingSearchSource;
}

export interface PostingGeoInput {
  latitude: number;
  longitude: number;
}

export interface UpsertPostingInput {
  organizationId: string;
  variant: PostingVariant;
  name: string;
  description: string;
  pricing: PostingPricing;
  photos: ManagedPostingPhotoInput[];
  tags: string[];
  details: PostingDetails;
  availabilityStatus: PostingAvailabilityStatus;
  availabilityNotes?: string | null;
  maxBookingDurationDays?: number | null;
  minBookingDurationDays?: number | null;
  advanceNoticeDays?: number | null;
  cancellationPolicy?: PostingCancellationPolicy | null;
  cancellationPolicyNotes?: string | null;
  availabilityBlocks: PostingAvailabilityBlockInput[];
  location: PostingLocationRecord;
}

export interface ListOwnerPostingsInput {
  organizationId: string;
  page: number;
  pageSize: number;
  status?: PostingStatus;
}

export interface BatchOwnerPostingsInput {
  organizationId: string;
  ids: string[];
}

export interface BatchPublicPostingsInput {
  ids: string[];
}

export interface GetPostingInput {
  id: string;
  viewerId?: string;
}

export interface SearchPostingsInput {
  page: number;
  pageSize: number;
  query?: string;
  family?: PostingFamily;
  subtype?: PostingSubtype;
  /**
   * Multi-tag search is conjunctive: a posting must contain every requested tag.
   */
  tags?: string[];
  availabilityStatus?: PostingAvailabilityStatus;
  minDailyPrice?: number;
  maxDailyPrice?: number;
  geo?: {
    latitude: number;
    longitude: number;
    radiusKm?: number;
  };
  availabilityWindow?: {
    startAt: string;
    endAt: string;
  };
  attributeFilters?: SearchAttributeFilterInput[];
  sort: PostingSort;
}

export interface PostingSearchDocument {
  id: string;
  organizationId: string;
  status: PostingStatus;
  variant: PostingVariant;
  name: string;
  description: string;
  tags: string[];
  availabilityStatus: PostingAvailabilityStatus;
  searchableAttributes: Record<string, PostingAttributeValue>;
  pricing: PostingPricing;
  pricingCurrency: string;
  location: {
    latitude: number;
    longitude: number;
    city: string;
    region: string;
    country: string;
    postalCode?: string;
  };
  photos: Array<{
    blobUrl: string;
    position: number;
  }>;
  blockedRanges: Array<{
    startAt: string;
    endAt: string;
    source: "availability_block" | "booking_request" | "renting";
  }>;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export function parsePostingDetailsForVariant(
  variant: PostingVariant,
  details: unknown,
): PostingDetails {
  switch (variant.family) {
    case "place":
      return placePostingDetailsSchema.parse(details);
    case "equipment":
      return equipmentPostingDetailsSchema.parse(details);
    case "vehicle":
      return vehiclePostingDetailsSchema.parse(details);
  }
}

export function toPostingAttributes(
  details: PostingDetails,
): Record<string, PostingAttributeValue> {
  return details as Record<string, PostingAttributeValue>;
}

export function isPostingPubliclyVisible(posting: {
  status: PostingStatus;
  archivedAt?: string | null;
}): boolean {
  return posting.status === "published" && !posting.archivedAt;
}

export function isPostingSearchIndexable(status: PostingStatus): boolean {
  return status === "published";
}

export function toPublicPostingRecord(
  posting: PostingRecord | PublicPostingRecord,
): PublicPostingRecord {
  const publicPosting = {
    ...posting,
  } as Record<string, unknown>;
  delete publicPosting.organizationId;
  const primaryPhoto =
    posting.photos.find((photo) => photo.position === 0) ?? posting.photos[0];

  return {
    ...(publicPosting as unknown as PublicPostingRecord),
    primaryPhotoUrl: primaryPhoto?.blobUrl,
    primaryThumbnailUrl: primaryPhoto?.thumbnailBlobUrl,
    effectiveMaxBookingDurationDays:
      posting.maxBookingDurationDays ?? DEFAULT_MAX_BOOKING_DURATION_DAYS,
    location: {
      city: posting.location.city,
      region: posting.location.region,
      country: posting.location.country,
      postalCode: posting.location.postalCode,
      latitude: Number(posting.location.latitude.toFixed(2)),
      longitude: Number(posting.location.longitude.toFixed(2)),
    },
  };
}

export interface PostingSearchOutboxRecord {
  id: string;
  postingId?: string;
  reindexRunId?: string;
  operation: "upsert" | "delete" | "barrier";
  dedupeKey: string;
  targetIndexName?: string;
  attempts: number;
  publishAttempts: number;
  availableAt: string;
  processingAt?: string;
  publishedAt?: string;
  indexedAt?: string;
  deadLetteredAt?: string;
  brokerMessageId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}
