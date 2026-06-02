import { z } from "zod";
import type { AppRole } from "@/features/auth/auth.model";

export const reportSubjectTypeSchema = z.enum([
  "posting",
  "posting_review",
  "user",
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
  assignedTo: z.string().trim().max(64).optional(),
  reporterId: z.string().trim().max(64).optional(),
  sort: reportSortSchema.default("newest"),
});

export const assignContentReportRequestSchema = z.object({
  assignedModeratorId: z.string().trim().min(1).max(64).nullable().optional(),
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
  id: string;
  email: string;
  username?: string;
  avatarUrl?: string;
  role: AppRole;
}

export interface ContentReportOrganizationSummary {
  id: string;
  name: string;
}

export interface PostingReportSubjectSnapshot {
  subjectType: "posting";
  summaryText: string;
  posting: {
    id: string;
    name: string;
    status: string;
    organization: ContentReportOrganizationSummary;
  };
}

export interface PostingReviewReportSubjectSnapshot {
  subjectType: "posting_review";
  summaryText: string;
  review: {
    id: string;
    rating: number;
    title?: string;
    commentExcerpt?: string;
    reviewer: ContentReportUserSummary;
    posting: {
      id: string;
      name: string;
    };
  };
}

export interface UserReportSubjectSnapshot {
  subjectType: "user";
  summaryText: string;
  user: ContentReportUserSummary;
}

export type ContentReportSubjectSnapshot =
  | PostingReportSubjectSnapshot
  | PostingReviewReportSubjectSnapshot
  | UserReportSubjectSnapshot;

export interface ContentReportEventRecord {
  id: string;
  eventType: ReportEventType;
  fromStatus?: ReportStatus;
  toStatus?: ReportStatus;
  assignmentUserId?: string;
  note?: string;
  actor: ContentReportUserSummary;
  createdAt: string;
}

export interface ContentReportRecord {
  id: string;
  reporterId: string;
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
  reporterId?: string;
  sort: ReportSort;
}

export interface AssignContentReportInput {
  actorUserId: string;
  actorRole: AppRole;
  reportId: string;
  assignedModeratorId?: string | null;
}

export interface UpdateContentReportStatusInput {
  actorUserId: string;
  actorRole: AppRole;
  reportId: string;
  status: ReportStatus;
  resolutionCode?: ReportResolutionCode;
  resolutionSummary?: string;
  note?: string;
}

export interface CreateContentReportInput {
  reporterId: string;
  subjectType: ReportSubjectType;
  subjectId: string;
  reasonCode: ReportReasonCode;
  title: string;
  description: string;
}

export interface ContentReportSearchDocument {
  id: string;
  subjectType: ReportSubjectType;
  subjectId: string;
  reasonCode: ReportReasonCode;
  status: ReportStatus;
  title: string;
  description: string;
  subjectSnapshotText: string;
  reporterId: string;
  reporterEmail: string;
  reporterUsername?: string;
  reporterRole: AppRole;
  assignedModeratorId?: string;
  assignedModeratorEmail?: string;
  assignedModeratorUsername?: string;
  assignedModeratorRole?: AppRole;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
}

export interface ContentReportSearchOutboxRecord {
  id: string;
  reportId: string;
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
