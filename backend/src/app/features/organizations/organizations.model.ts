import { z } from "zod";

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

export const updateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  ...sharedOrganizationProfileShape,
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

export const listPublicOrganizationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(100).optional(),
});

export type CreateOrganizationRequestBody = z.infer<
  typeof createOrganizationRequestSchema
>;
export type UpdateOrganizationRequestBody = z.infer<
  typeof updateOrganizationRequestSchema
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
  name: string;
  role: OrganizationRole;
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
