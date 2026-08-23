import type { Request, Response } from "express";
import { getRequestUrl } from "@/configuration/http/request";
import { accepted, ok } from "@/configuration/http/responses";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { requireMinimumRole } from "@/features/auth/authorization";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import type { OrganizationsSearchService } from "@/features/organizations/search/search.service";

// Admin-only operations for the organization search index (reindex/backfill,
// status inspection, dead-letter replay, retained-index cleanup). Mirrors the
// postings SearchController.
export class OrganizationsSearchController {
  constructor(
    private readonly organizationsSearchService: OrganizationsSearchService,
  ) {}

  startReindex = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAdmin(request);
    void auth;
    const result = await this.organizationsSearchService.startReindex();
    accepted(response, result, {
      message: "Organization search reindex has been started.",
    });
  };

  getReindexRun = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAdmin(request);
    void auth;
    const result = await this.organizationsSearchService.getReindexRun(
      this.requireRouteId(request),
    );
    ok(response, result ?? { run: null });
  };

  getStatus = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAdmin(request);
    void auth;
    const result = await this.organizationsSearchService.getStatus();
    ok(response, result);
  };

  replayDeadLettered = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAdmin(request);
    void auth;
    const url = getRequestUrl(request);
    const limit = this.readPositiveIntQuery(url, "limit", 100);
    const result =
      await this.organizationsSearchService.replayDeadLetteredOutbox(limit);
    accepted(response, result, {
      message:
        "Dead-lettered organization search outbox entries are being replayed.",
    });
  };

  cleanupRetainedIndices = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAdmin(request);
    void auth;
    const result =
      await this.organizationsSearchService.cleanupRetainedIndices();
    accepted(response, result, {
      message: "Organization search index cleanup has been started.",
    });
  };

  private requireRouteId(request: Request): string {
    return requireSafeRouteParam(request, "id");
  }

  private readPositiveIntQuery(
    url: URL,
    key: string,
    fallback: number,
  ): number {
    const rawValue = url.searchParams.get(key)?.trim();

    if (!rawValue) {
      return fallback;
    }

    const parsed = Number(rawValue);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private async requireAdmin(request: Request) {
    const auth = await requireJwtAuth(request);
    requireMinimumRole(auth, "admin");
    return auth;
  }
}
