import type { Request, Response } from "express";
import { getRequestUrl } from "@/configuration/http/request";
import {
  created,
  mergeResponseMeta,
  ok,
  paginationMeta,
  pickMeta,
} from "@/configuration/http/responses";
import { requireSessionAuth } from "@/configuration/middlewares/jwt-middleware";
import {
  parseRequestBody,
  RequestValidationError,
} from "@/configuration/validation/request";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import { getAuthRole, requireAnyRole } from "@/features/auth/authorization";
import type { ReportsService } from "@/features/reports/reports.service";
import {
  assignContentReportRequestSchema,
  createContentReportRequestSchema,
  listContentReportsQuerySchema,
  updateContentReportStatusRequestSchema,
} from "@/features/reports/reports.model";

export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  create = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireSessionAuth(request);
    const body = await parseRequestBody(
      request,
      createContentReportRequestSchema,
    );
    const result = await this.reportsService.create({
      reporterId: auth.sub,
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      reasonCode: body.reasonCode,
      title: body.title.trim(),
      description: body.description.trim(),
    });

    created(response, result, {
      message: "Report created successfully.",
    });
  };

  listModeration = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireModerator(request);
    void auth;
    const result = await this.reportsService.listModeration(
      this.parseListInput(request),
    );
    ok(response, result, {
      meta: mergeResponseMeta(
        paginationMeta(result),
        pickMeta(result, ["source"]),
      ),
    });
  };

  getModerationById = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireModerator(request);
    void auth;
    const result = await this.reportsService.getModerationDetail(
      this.requireRouteId(request),
    );
    ok(response, result);
  };

  assign = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireModerator(request);
    const body = await parseRequestBody(
      request,
      assignContentReportRequestSchema,
    );
    const result = await this.reportsService.assign({
      actorUserId: auth.sub,
      actorRole: getAuthRole(auth),
      reportId: this.requireRouteId(request),
      assignedModeratorId:
        body.assignedModeratorId === undefined
          ? undefined
          : body.assignedModeratorId,
    });
    ok(response, result, {
      message: "Report assignment updated successfully.",
    });
  };

  updateStatus = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireModerator(request);
    const body = await parseRequestBody(
      request,
      updateContentReportStatusRequestSchema,
    );
    const result = await this.reportsService.updateStatus({
      actorUserId: auth.sub,
      actorRole: getAuthRole(auth),
      reportId: this.requireRouteId(request),
      status: body.status,
      resolutionCode: body.resolutionCode,
      resolutionSummary: body.resolutionSummary,
      note: body.note,
    });
    ok(response, result, {
      message: "Report status updated successfully.",
    });
  };

  private async requireModerator(request: Request) {
    const auth = await requireSessionAuth(request);
    requireAnyRole(auth, ["moderator", "admin"]);
    return auth;
  }

  private requireRouteId(request: Request): string {
    return requireSafeRouteParam(request, "id");
  }

  private parseListInput(request: Request) {
    const url = getRequestUrl(request);

    try {
      return listContentReportsQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        subjectType: url.searchParams.get("subjectType") ?? undefined,
        reasonCode: url.searchParams.get("reasonCode") ?? undefined,
        assignedTo: url.searchParams.get("assignedTo") ?? undefined,
        reporterId: url.searchParams.get("reporterId") ?? undefined,
        sort: url.searchParams.get("sort") ?? undefined,
      });
    } catch (error) {
      if ("issues" in (error as object)) {
        const issues = (
          error as { issues?: Array<{ path: PropertyKey[]; message: string }> }
        ).issues;

        throw new RequestValidationError(
          "Request query validation failed.",
          (issues ?? []).map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        );
      }

      throw error;
    }
  }
}
