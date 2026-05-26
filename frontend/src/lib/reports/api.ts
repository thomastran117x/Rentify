import { readJson, toApiError, unwrapApiResponse } from "@/lib/api/response";
import { getDeviceId, getDevicePlatform } from "@/lib/auth/device";
import { readStoredSession } from "@/lib/auth/storage";
import { publicEnv } from "@/lib/env";

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

export interface ContentReportSubjectSnapshot {
  subjectType: ReportSubjectType;
  summaryText: string;
  posting?: {
    id: string;
    name: string;
    status: string;
    owner: ContentReportUserSummary;
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
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
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

const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function readCsrfToken(): string | undefined {
  const token = readCookie(CSRF_COOKIE_NAME);
  return token ? decodeURIComponent(token) : undefined;
}

async function authenticatedJson<
  TResponse,
  TBody extends object | undefined = undefined,
>(method: "GET" | "POST", path: string, body?: TBody): Promise<TResponse> {
  const deviceId = getDeviceId();
  const devicePlatform = getDevicePlatform();
  const session = readStoredSession();
  const csrfToken = readCsrfToken();
  const response = await fetch(`${publicEnv.apiBaseUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(session?.accessToken
        ? { authorization: `Bearer ${session.accessToken}` }
        : {}),
      ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
      ...(deviceId ? { "x-device-id": deviceId } : {}),
      ...(devicePlatform ? { "x-device-platform": devicePlatform } : {}),
    },
    credentials: "include",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await readJson(response);

  if (!response.ok) {
    throw toApiError(response, payload);
  }

  return unwrapApiResponse<TResponse>(payload);
}

function buildQuery(filters: ListContentReportsFilters): string {
  const searchParams = new URLSearchParams();

  if (filters.q) {
    searchParams.set("q", filters.q);
  }

  if (filters.status) {
    searchParams.set("status", filters.status);
  }

  if (filters.subjectType) {
    searchParams.set("subjectType", filters.subjectType);
  }

  if (filters.reasonCode) {
    searchParams.set("reasonCode", filters.reasonCode);
  }

  if (filters.assignedTo) {
    searchParams.set("assignedTo", filters.assignedTo);
  }

  if (filters.reporterId) {
    searchParams.set("reporterId", filters.reporterId);
  }

  searchParams.set("page", String(filters.page ?? 1));
  searchParams.set("pageSize", String(filters.pageSize ?? 20));
  searchParams.set("sort", filters.sort ?? "newest");

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
}

export const reportsApi = {
  create(input: CreateContentReportRequest): Promise<ContentReportRecord> {
    return authenticatedJson<ContentReportRecord, CreateContentReportRequest>(
      "POST",
      "/reports",
      input,
    );
  },

  listModeration(
    filters: ListContentReportsFilters = {},
  ): Promise<ListContentReportsResult> {
    return authenticatedJson<ListContentReportsResult>(
      "GET",
      `/moderation/reports${buildQuery(filters)}`,
    );
  },

  getModerationReport(reportId: string): Promise<ContentReportDetailRecord> {
    return authenticatedJson<ContentReportDetailRecord>(
      "GET",
      `/moderation/reports/${encodeURIComponent(reportId)}`,
    );
  },

  assign(
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
