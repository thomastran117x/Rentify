import { z } from "zod";
import type { AppRole } from "@/features/auth/auth.model";
import { uuidSchema, type Uuid } from "@/configuration/validation/uuid";

export const reportSubjectTypeSchema = z.enum([
  "posting",
  "posting_review",
  "user",
  "organization_blog_comment",
]);
export const reportReasonCodeSchema = z.enum([
  "spam",
  "fraud_or_scam",
  "harassment_or_hate",
  "sexual_content",
  "violence_or_threats",
  "illegal_or_prohibited",
  "impersonation",
  "misleading_information",
  "review_manipulation",
  "other",
]);
export const reportStatusSchema = z.enum([
  "open",
  "under_review",
  "resolved",
  "dismissed",
]);
export const reportResolutionCodeSchema = z.enum([
  "action_taken",
  "no_violation",
  "duplicate",
  "insufficient_information",
]);
export const reportEventTypeSchema = z.enum([
  "created",
  "assigned",
  "status_changed",
  "note_added",
]);
export const reportSearchSourceSchema = z.enum(["elasticsearch", "database"]);
export const reportSortSchema = z.enum([
  "newest",
  "oldest",
  "recentlyReviewed",
]);

const trimmedStringSchema = z.string().trim().min(1);

export const createContentReportRequestSchema = z.object({
  subjectType: reportSubjectTypeSchema,
  subjectId: trimmedStringSchema.max(64),
  reasonCode: reportReasonCodeSchema,
  title: trimmedStringSchema.min(3).max(120),
  description: trimmedStringSchema.min(10).max(2000),
});

export const listContentReportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  q: z.string().trim().min(1).max(120).optional(),
  status: reportStatusSchema.optional(),
  subjectType: reportSubjectTypeSchema.optional(),
  reasonCode: reportReasonCodeSchema.optional(),
  // Also accepts the literal "unassigned", so this is not an identifier schema.
  assignedTo: z.string().trim().max(64).optional(),
  reporterId: z.string().trim().pipe(uuidSchema).optional(),
  sort: reportSortSchema.default("newest"),
});

export const assignContentReportRequestSchema = z.object({
  assignedModeratorId: z.string().trim().pipe(uuidSchema).nullable().optional(),
});

export const updateContentReportStatusRequestSchema = z
  .object({
    status: reportStatusSchema,
    resolutionCode: reportResolutionCodeSchema.optional(),
    resolutionSummary: z.string().trim().min(1).max(2000).optional(),
    note: z.string().trim().min(1).max(2000).optional(),
  })
  .superRefine((value, context) => {
    const requiresResolution =
      value.status === "resolved" || value.status === "dismissed";

    if (requiresResolution && !value.resolutionCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolutionCode"],
        message:
          "Resolution code is required when a report is resolved or dismissed.",
      });
    }
  });

export type ReportSubjectType = z.infer<typeof reportSubjectTypeSchema>;
export type ReportReasonCode = z.infer<typeof reportReasonCodeSchema>;
export type ReportStatus = z.infer<typeof reportStatusSchema>;
export type ReportResolutionCode = z.infer<typeof reportResolutionCodeSchema>;
export type ReportEventType = z.infer<typeof reportEventTypeSchema>;
export type ReportSearchSource = z.infer<typeof reportSearchSourceSchema>;
export type ReportSort = z.infer<typeof reportSortSchema>;

export type CreateContentReportRequestBody = z.infer<
  typeof createContentReportRequestSchema
>;
export type ListContentReportsQuery = z.infer<
  typeof listContentReportsQuerySchema
>;
export type AssignContentReportRequestBody = z.infer<
  typeof assignContentReportRequestSchema
>;
export type UpdateContentReportStatusRequestBody = z.infer<
  typeof updateContentReportStatusRequestSchema
>;

export interface ContentReportUserSummary {
  id: Uuid;
  email: string;
  username?: string;
  avatarUrl?: string;
  role: AppRole;
}

export interface ContentReportOrganizationSummary {
  id: Uuid;
  name: string;
}

export interface PostingReportSubjectSnapshot {
  subjectType: "posting";
  summaryText: string;
  posting: {
    id: Uuid;
    name: string;
    status: string;
    organization: ContentReportOrganizationSummary;
  };
}

export interface PostingReviewReportSubjectSnapshot {
  subjectType: "posting_review";
  summaryText: string;
  review: {
    id: Uuid;
    rating: number;
    title?: string;
    commentExcerpt?: string;
    reviewer: ContentReportUserSummary;
    posting: {
      id: Uuid;
      name: string;
    };
  };
}

export interface UserReportSubjectSnapshot {
  subjectType: "user";
  summaryText: string;
  user: ContentReportUserSummary;
}

export interface OrganizationBlogCommentReportSubjectSnapshot {
  subjectType: "organization_blog_comment";
  summaryText: string;
  comment: {
    id: Uuid;
    bodyExcerpt?: string;
    author: ContentReportUserSummary;
    post: {
      id: Uuid;
      title: string;
      slug: string;
      organization: ContentReportOrganizationSummary;
    };
  };
}

export type ContentReportSubjectSnapshot =
  | PostingReportSubjectSnapshot
  | PostingReviewReportSubjectSnapshot
  | UserReportSubjectSnapshot
  | OrganizationBlogCommentReportSubjectSnapshot;

export interface ContentReportEventRecord {
  id: Uuid;
  eventType: ReportEventType;
  fromStatus?: ReportStatus;
  toStatus?: ReportStatus;
  assignmentUserId?: Uuid;
  note?: string;
  actor: ContentReportUserSummary;
  createdAt: string;
}

export interface ContentReportRecord {
  id: Uuid;
  reporterId: Uuid;
  subjectType: ReportSubjectType;
  subjectId: string;
  reasonCode: ReportReasonCode;
  title: string;
  description: string;
  status: ReportStatus;
  resolutionCode?: ReportResolutionCode;
  resolutionSummary?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  reporter: ContentReportUserSummary;
  assignedModerator?: ContentReportUserSummary;
  subjectSnapshot: ContentReportSubjectSnapshot;
}

export interface ContentReportDetailRecord extends ContentReportRecord {
  events: ContentReportEventRecord[];
}

export interface ReportPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ListContentReportsResult {
  reports: ContentReportRecord[];
  pagination: ReportPagination;
  source: ReportSearchSource;
  query?: string;
}

export interface ListContentReportsInput {
  page: number;
  pageSize: number;
  query?: string;
  status?: ReportStatus;
  subjectType?: ReportSubjectType;
  reasonCode?: ReportReasonCode;
  assignedTo?: string;
  reporterId?: Uuid;
  sort: ReportSort;
}

export interface AssignContentReportInput {
  actorUserId: Uuid;
  actorRole: AppRole;
  reportId: Uuid;
  assignedModeratorId?: Uuid | null;
}

export interface UpdateContentReportStatusInput {
  actorUserId: Uuid;
  actorRole: AppRole;
  reportId: Uuid;
  status: ReportStatus;
  resolutionCode?: ReportResolutionCode;
  resolutionSummary?: string;
  note?: string;
}

export interface CreateContentReportInput {
  reporterId: Uuid;
  subjectType: ReportSubjectType;
  subjectId: string;
  reasonCode: ReportReasonCode;
  title: string;
  description: string;
}

export interface ContentReportSearchDocument {
  id: Uuid;
  subjectType: ReportSubjectType;
  subjectId: string;
  reasonCode: ReportReasonCode;
  status: ReportStatus;
  title: string;
  description: string;
  subjectSnapshotText: string;
  reporterId: Uuid;
  reporterEmail: string;
  reporterUsername?: string;
  reporterRole: AppRole;
  assignedModeratorId?: Uuid;
  assignedModeratorEmail?: string;
  assignedModeratorUsername?: string;
  assignedModeratorRole?: AppRole;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
}

export interface ContentReportSearchOutboxRecord {
  id: Uuid;
  reportId: Uuid;
  operation: "upsert" | "delete";
  attempts: number;
  availableAt: string;
  processingAt?: string;
  processedAt?: string;
  deadLetteredAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}
