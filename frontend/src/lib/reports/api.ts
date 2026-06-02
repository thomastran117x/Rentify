export type {
  AssignContentReportRequest,
  ContentReportDetailRecord,
  ContentReportEventRecord,
  ContentReportRecord,
  ContentReportSubjectSnapshot,
  ContentReportUserSummary,
  CreateContentReportRequest,
  ListContentReportsFilters,
  ListContentReportsResult,
  ReportReasonCode,
  ReportResolutionCode,
  ReportSearchSource,
  ReportSort,
  ReportStatus,
  ReportSubjectType,
  UpdateContentReportStatusRequest,
} from "@/lib/moderation/api";
import { moderationApi } from "@/lib/moderation/api";

export const reportsApi = {
  create: moderationApi.createReport,
  listModeration: moderationApi.listReports,
  getModerationReport: moderationApi.getReport,
  assign: moderationApi.assignReport,
  updateStatus: moderationApi.updateStatus,
};
