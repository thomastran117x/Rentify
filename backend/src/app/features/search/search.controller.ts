import type { Request, Response } from "express";
import { getRequestUrl } from "@/configuration/http/request";
import { accepted, ok } from "@/configuration/http/responses";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { requireMinimumRole } from "@/features/auth/authorization";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import type { SearchService } from "@/features/search/search.service";

export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  startReindex = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAdmin(request);
    void auth;
    const result = await this.searchService.startReindex();
    accepted(response, result, {
      message: "Search reindex has been started.",
    });
  };

  getReindexRun = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAdmin(request);
    void auth;
    const result = await this.searchService.getReindexRun(
      this.requireRouteId(request),
    );
    ok(response, result ?? { run: null });
  };

  getStatus = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAdmin(request);
    void auth;
    const result = await this.searchService.getStatus();
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
    const result = await this.searchService.replayDeadLetteredOutbox(limit);
    accepted(response, result, {
      message: "Dead-lettered search outbox entries are being replayed.",
    });
  };

  cleanupRetainedIndices = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAdmin(request);
    void auth;
    const result = await this.searchService.cleanupRetainedIndices();
    accepted(response, result, {
      message: "Search index cleanup has been started.",
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
