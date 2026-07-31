import { z } from "zod";

import {
  ORGANIZATION_SLUG_MAX_LENGTH,
  ORGANIZATION_SLUG_MIN_LENGTH,
  ORGANIZATION_SLUG_PATTERN,
  isReservedOrganizationSlug,
  looksLikeUuid,
} from "@/features/organizations/organization-slug";

const resourceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const organizationRoleSchema = z.enum([
  "primary_manager",
  "manager",
  "operator",
]);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const organizationInviteStatusSchema = z.enum([
  "pending",
  "accepted",
  "revoked",
  "expired",
]);
export type OrganizationInviteStatus = z.infer<
  typeof organizationInviteStatusSchema
>;

export const organizationResourceIdSchema = z
  .string()
  .trim()
  .regex(resourceIdPattern, "Invalid organization resource id.");
export const organizationInviteTokenSchema = z.string().trim().min(1).max(200);

// A slug in its canonical form. Deliberately performs no normalization so that
// callers can distinguish "valid and canonical" from "valid once normalized".
const canonicalOrganizationSlugSchema = z
  .string()
  .min(
    ORGANIZATION_SLUG_MIN_LENGTH,
    `URL must be at least ${ORGANIZATION_SLUG_MIN_LENGTH} characters long.`,
  )
  .max(
    ORGANIZATION_SLUG_MAX_LENGTH,
    `URL must be at most ${ORGANIZATION_SLUG_MAX_LENGTH} characters long.`,
  )
  .regex(
    ORGANIZATION_SLUG_PATTERN,
    "URL may only contain lowercase letters, numbers, and single hyphens.",
  )
  // A 36-character hex-and-dash string satisfies the charset rule, and would
  // then shadow a real id lookup.
  .refine((value) => !looksLikeUuid(value), "URL cannot look like an id.")
  .refine(
    (value) => !isReservedOrganizationSlug(value),
    "That URL is reserved. Please choose another.",
  );

/**
 * For slugs typed into a form: normalize first, then validate. "Harbor Rentals"
 * typed with capitals should be accepted and stored lowercase.
 */
export const organizationSlugInputSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(canonicalOrganizationSlugSchema);

/**
 * For slugs arriving in a URL path: validate without normalizing, so that a
 * non-canonical form (uppercase, trailing hyphen) is rejected rather than
 * silently served at a non-canonical URL. The caller normalizes and redirects.
 */
export const organizationSlugPathSchema = z
  .string()
  .pipe(canonicalOrganizationSlugSchema);

// Treat empty/whitespace-only form values as null so blank optional inputs
// (which arrive as "") don't fail url/email validation.
const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0 ? null : value,
    schema,
  );

const optionalText = (max: number) =>
  emptyToNull(z.string().trim().max(max).nullable().optional());

const organizationCustomFieldsSchema = emptyToNull(
  z
    .record(z.string().trim().min(1).max(80), z.string().trim().max(1000))
    .refine((value) => Object.keys(value).length <= 20, {
      message: "An organization may define at most 20 custom fields.",
    })
    .nullable()
    .optional(),
);

// Editable profile fields shared by the create and update request schemas.
export const sharedOrganizationProfileShape = {
  description: optionalText(5000),
  websiteUrl: emptyToNull(
    z.url("Website must be a valid URL.").max(500).nullable().optional(),
  ),
  contactEmail: emptyToNull(
    z.email("Contact email must be valid.").max(320).nullable().optional(),
  ),
  contactPhone: emptyToNull(
    z
      .string()
      .trim()
      .min(7, "Phone number must be at least 7 characters long.")
      .max(40, "Phone number must be at most 40 characters long.")
      .regex(/^[0-9+()\-\s]+$/, "Phone number contains unsupported characters.")
      .nullable()
      .optional(),
  ),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(120),
  region: optionalText(120),
  country: optionalText(120),
  postalCode: optionalText(20),
  logoUrl: emptyToNull(
    z.url("Logo URL must be a valid URL.").max(1024).nullable().optional(),
  ),
  logoBlobName: optionalText(1024),
  customFields: organizationCustomFieldsSchema,
} as const;

export const createOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  ...sharedOrganizationProfileShape,
});

// `slug` is deliberately absent: changing the public URL retires the old one
// and has consequences a routine profile save should never trigger. It has its
// own endpoint and request schema below.
export const updateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  ...sharedOrganizationProfileShape,
});

export const updateOrganizationSlugRequestSchema = z.object({
  slug: organizationSlugInputSchema,
});

export const createOrganizationInviteRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  role: organizationRoleSchema,
});

export const setActiveOrganizationRequestSchema = z.object({
  organizationId: organizationResourceIdSchema,
});

export const updateOrganizationMemberRequestSchema = z.object({
  role: organizationRoleSchema,
});

export const publicOrganizationSortSchema = z.enum([
  "relevance",
  "nameAsc",
  "nameDesc",
  "newest",
  "oldest",
]);
export type PublicOrganizationSort = z.infer<
  typeof publicOrganizationSortSchema
>;

export const listPublicOrganizationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(100).optional(),
  sort: publicOrganizationSortSchema.optional(),
});

export type CreateOrganizationRequestBody = z.infer<
  typeof createOrganizationRequestSchema
>;
export type UpdateOrganizationRequestBody = z.infer<
  typeof updateOrganizationRequestSchema
>;
export type UpdateOrganizationSlugRequestBody = z.infer<
  typeof updateOrganizationSlugRequestSchema
>;
export type CreateOrganizationInviteRequestBody = z.infer<
  typeof createOrganizationInviteRequestSchema
>;
export type SetActiveOrganizationRequestBody = z.infer<
  typeof setActiveOrganizationRequestSchema
>;
export type UpdateOrganizationMemberRequestBody = z.infer<
  typeof updateOrganizationMemberRequestSchema
>;
export type ListPublicOrganizationsQuery = z.infer<
  typeof listPublicOrganizationsQuerySchema
>;

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  role: OrganizationRole;
}

/**
 * Outcome of mapping a public URL reference onto an organization.
 *
 * `canonicalSlug` is always the organization's current slug, so callers can
 * detect that they were reached via a retired alias and redirect.
 */
export interface ResolvedOrganizationReference {
  organizationId: string;
  canonicalSlug: string;
  name: string;
  matchedBy: "canonical-slug" | "alias";
}

// Editable, self-describing profile fields on an organization. All optional so
// existing organizations remain valid and blank inputs stay null.
export interface OrganizationProfileFields {
  description: string | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  logoUrl: string | null;
  logoBlobName: string | null;
  customFields: Record<string, string> | null;
}

export type OrganizationProfileInput = Partial<OrganizationProfileFields>;

export interface PublicOrganizationProfileFields {
  description: string | null;
  websiteUrl: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  logoUrl: string | null;
  customFields: Record<string, string> | null;
}

export interface PublicOrganizationStats {
  publishedPostingCount: number;
}

export interface PublicOrganizationSummary extends PublicOrganizationStats {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicOrganizationDetailResult {
  organization: PublicOrganizationSummary & PublicOrganizationProfileFields;
  stats: PublicOrganizationStats;
}

export interface PublicOrganizationListResult {
  organizations: Array<
    PublicOrganizationSummary & PublicOrganizationProfileFields
  >;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  query?: string;
  source?: OrganizationSearchSource;
}

// Field names audited when an organization's profile changes (also used to
// restore a prior version). Keep in sync with OrganizationProfileFields + name.
export const ORGANIZATION_EDITABLE_FIELDS = [
  "name",
  "description",
  "websiteUrl",
  "contactEmail",
  "contactPhone",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "country",
  "postalCode",
  "logoUrl",
  "logoBlobName",
  "customFields",
] as const;

const ORGANIZATION_PROFILE_FIELDS: (keyof OrganizationProfileFields)[] = [
  "description",
  "websiteUrl",
  "contactEmail",
  "contactPhone",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "country",
  "postalCode",
  "logoUrl",
  "logoBlobName",
  "customFields",
];

// Pull only the defined profile fields out of a parsed request body/input.
export function pickOrganizationProfileInput(
  source: Partial<OrganizationProfileFields>,
): OrganizationProfileInput {
  const result: OrganizationProfileInput = {};
  for (const field of ORGANIZATION_PROFILE_FIELDS) {
    if (source[field] !== undefined) {
      (result as Record<string, unknown>)[field] = source[field];
    }
  }
  return result;
}

export interface OrganizationMembershipSummary extends OrganizationSummary {
  membershipId: string;
  joinedAt: string;
  isActive: boolean;
}

export interface OrganizationMemberRecord {
  membershipId: string;
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  username: string;
  avatarUrl?: string;
  role: OrganizationRole;
  joinedAt: string;
}

export interface OrganizationInvitationActorSummary {
  id: string;
  email: string;
  username: string;
}

export interface OrganizationInvitationRecord {
  id: string;
  email: string;
  emailHint: string;
  role: OrganizationRole;
  status: OrganizationInviteStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  invitedBy: OrganizationInvitationActorSummary;
  acceptedBy?: OrganizationInvitationActorSummary;
}

export interface OrganizationWorkspaceResult {
  memberships: OrganizationMembershipSummary[];
  activeOrganization?: OrganizationSummary;
}

export interface OrganizationWorkspaceDetailResult {
  organization: {
    id: string;
    slug: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  } & OrganizationProfileFields;
  viewerRole: OrganizationRole;
  members: OrganizationMemberRecord[];
  invitations: OrganizationInvitationRecord[];
}

export interface OrganizationInvitePreviewResult {
  invitation: {
    organizationId: string;
    organizationName: string;
    emailHint: string;
    role: OrganizationRole;
    status: OrganizationInviteStatus;
    expiresAt: string;
  };
  viewer: {
    authenticated: boolean;
    email?: string;
    emailVerified?: boolean;
    matchesEmail: boolean;
    canAccept: boolean;
  };
}

export interface SetActiveOrganizationResult {
  activeOrganization: OrganizationSummary;
}

export interface CreateOrganizationInviteResult {
  invitation: OrganizationInvitationRecord;
}

export interface AcceptOrganizationInviteResult {
  accepted: true;
  organization: OrganizationSummary;
  membership: OrganizationMembershipSummary;
}

export interface CreateOrganizationInviteInput {
  organizationId: string;
  actorUserId: string;
  email: string;
  role: OrganizationRole;
}

export interface CreateOrganizationInput extends OrganizationProfileInput {
  actorUserId: string;
  name: string;
}

export interface CreateOrganizationResult {
  organization: OrganizationSummary;
  membership: OrganizationMembershipSummary;
}

export interface UpdateOrganizationInput extends OrganizationProfileInput {
  organizationId: string;
  actorUserId: string;
  name: string;
}

export interface ChangeOrganizationSlugInput {
  organizationId: string;
  actorUserId: string;
  slug: string;
}

export interface SetActiveOrganizationInput {
  userId: string;
  organizationId: string;
}

export type OrganizationScopedRole = OrganizationRole;

export interface UpdateOrganizationMemberInput {
  organizationId: string;
  actorUserId: string;
  membershipId: string;
  role: OrganizationRole;
}

export interface RemoveOrganizationMemberInput {
  organizationId: string;
  actorUserId: string;
  membershipId: string;
}

export interface RevokeOrganizationInviteInput {
  organizationId: string;
  actorUserId: string;
  invitationId: string;
}

export interface AcceptOrganizationInviteInput {
  token: string;
  userId: string;
}

export interface PreviewOrganizationInviteInput {
  token: string;
  userId?: string;
}

export interface ListPublicOrganizationsInput {
  page: number;
  pageSize: number;
  query?: string;
  sort?: PublicOrganizationSort;
}

// Where a public organization list result was served from. Elasticsearch is the
// primary path; the database fallback keeps the directory working when the
// search cluster is unavailable.
export type OrganizationSearchSource = "elasticsearch" | "database";

// The subset of organization fields projected into Elasticsearch. Kept
// intentionally lean: display data (e.g. publishedPostingCount) is hydrated
// from the database at read time so the index only carries what we search on.
export interface OrganizationSearchDocument {
  id: string;
  name: string;
  description: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationSearchOutboxRecord {
  id: string;
  organizationId?: string;
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

export function normalizeOrganizationInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function maskEmailAddress(email: string): string {
  const [localPart, domain] = email.split("@");

  if (!localPart || !domain) {
    return "hidden";
  }

  const normalizedLocalPart = localPart.trim();
  const visiblePrefix = normalizedLocalPart.slice(0, 1) || "*";
  return `${visiblePrefix}***@${domain}`;
}
