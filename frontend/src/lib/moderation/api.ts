import { authenticatedJson, buildPathWithQuery } from "@/lib/api/client";
import type { Pagination } from "@/lib/api/types";

export type ReportSubjectType = "posting" | "posting_review" | "user";
export type ReportReasonCode =
  | "spam"
  | "fraud_or_scam"
  | "harassment_or_hate"
  | "sexual_content"
  | "violence_or_threats"
  | "illegal_or_prohibited"
  | "impersonation"
  | "misleading_information"
  | "review_manipulation"
  | "other";
export type ReportStatus = "open" | "under_review" | "resolved" | "dismissed";
export type ReportResolutionCode =
  | "action_taken"
  | "no_violation"
  | "duplicate"
  | "insufficient_information";
export type ReportSearchSource = "elasticsearch" | "database";
export type ReportSort = "newest" | "oldest" | "recentlyReviewed";

export interface ContentReportUserSummary {
  id: string;
  email: string;
  username?: string;
  avatarUrl?: string;
  role: "user" | "owner" | "moderator" | "admin";
}

export interface ContentReportOrganizationSummary {
  id: string;
  name: string;
}

export interface ContentReportSubjectSnapshot {
  subjectType: ReportSubjectType;
  summaryText: string;
  posting?: {
    id: string;
    name: string;
    status: string;
    organization: ContentReportOrganizationSummary;
  };
  review?: {
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
  user?: ContentReportUserSummary;
}

export interface ContentReportEventRecord {
  id: string;
  eventType: "created" | "assigned" | "status_changed" | "note_added";
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

export interface ListContentReportsResult {
  reports: ContentReportRecord[];
  pagination: Pagination;
  source: ReportSearchSource;
  query?: string;
}

export interface CreateContentReportRequest {
  subjectType: ReportSubjectType;
  subjectId: string;
  reasonCode: ReportReasonCode;
  title: string;
  description: string;
}

export interface AssignContentReportRequest {
  assignedModeratorId?: string | null;
}

export interface UpdateContentReportStatusRequest {
  status: ReportStatus;
  resolutionCode?: ReportResolutionCode;
  resolutionSummary?: string;
  note?: string;
}

export interface ListContentReportsFilters {
  q?: string;
  status?: ReportStatus;
  subjectType?: ReportSubjectType;
  reasonCode?: ReportReasonCode;
  assignedTo?: string;
  reporterId?: string;
  page?: number;
  pageSize?: number;
  sort?: ReportSort;
}

export const moderationApi = {
  createReport(
    input: CreateContentReportRequest,
  ): Promise<ContentReportRecord> {
    return authenticatedJson<ContentReportRecord, CreateContentReportRequest>(
      "POST",
      "/reports",
      input,
    );
  },
  listReports(
    filters: ListContentReportsFilters = {},
  ): Promise<ListContentReportsResult> {
    return authenticatedJson<ListContentReportsResult>(
      "GET",
      buildPathWithQuery("/moderation/reports", {
        q: filters.q,
        status: filters.status,
        subjectType: filters.subjectType,
        reasonCode: filters.reasonCode,
        assignedTo: filters.assignedTo,
        reporterId: filters.reporterId,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 20,
        sort: filters.sort ?? "newest",
      }),
    );
  },
  getReport(reportId: string): Promise<ContentReportDetailRecord> {
    return authenticatedJson<ContentReportDetailRecord>(
      "GET",
      `/moderation/reports/${encodeURIComponent(reportId)}`,
    );
  },
  assignReport(
    reportId: string,
    input: AssignContentReportRequest,
  ): Promise<ContentReportRecord> {
    return authenticatedJson<ContentReportRecord, AssignContentReportRequest>(
      "POST",
      `/moderation/reports/${encodeURIComponent(reportId)}/assignment`,
      input,
    );
  },
  updateStatus(
    reportId: string,
    input: UpdateContentReportStatusRequest,
  ): Promise<ContentReportRecord> {
    return authenticatedJson<
      ContentReportRecord,
      UpdateContentReportStatusRequest
    >(
      "POST",
      `/moderation/reports/${encodeURIComponent(reportId)}/status`,
      input,
    );
  },
};
