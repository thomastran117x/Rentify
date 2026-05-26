import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
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

  create = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireSessionAuth(context);
    const body = await parseRequestBody(
      context,
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

    return created(context, result, {
      message: "Report created successfully.",
    });
  };

  listModeration = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireModerator(context);
    void auth;
    const result = await this.reportsService.listModeration(
      this.parseListInput(context),
    );
    return ok(context, result, {
      meta: mergeResponseMeta(
        paginationMeta(result),
        pickMeta(result, ["source"]),
      ),
    });
  };

  getModerationById = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireModerator(context);
    void auth;
    const result = await this.reportsService.getModerationDetail(
      this.requireRouteId(context),
    );
    return ok(context, result);
  };

  assign = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireModerator(context);
    const body = await parseRequestBody(
      context,
      assignContentReportRequestSchema,
    );
    const result = await this.reportsService.assign({
      actorUserId: auth.sub,
      actorRole: getAuthRole(auth),
      reportId: this.requireRouteId(context),
      assignedModeratorId:
        body.assignedModeratorId === undefined
          ? undefined
          : body.assignedModeratorId,
    });
    return ok(context, result, {
      message: "Report assignment updated successfully.",
    });
  };

  updateStatus = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireModerator(context);
    const body = await parseRequestBody(
      context,
      updateContentReportStatusRequestSchema,
    );
    const result = await this.reportsService.updateStatus({
      actorUserId: auth.sub,
      actorRole: getAuthRole(auth),
      reportId: this.requireRouteId(context),
      status: body.status,
      resolutionCode: body.resolutionCode,
      resolutionSummary: body.resolutionSummary,
      note: body.note,
    });
    return ok(context, result, {
      message: "Report status updated successfully.",
    });
  };

  private async requireModerator(context: Context<AppBindings>) {
    const auth = await requireSessionAuth(context);
    requireAnyRole(auth, ["moderator", "admin"]);
    return auth;
  }

  private requireRouteId(context: Context<AppBindings>): string {
    return requireSafeRouteParam(context, "id");
  }

  private parseListInput(context: Context<AppBindings>) {
    const url = new URL(context.req.url);

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
