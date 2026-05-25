import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { accepted, ok } from "@/configuration/http/responses";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { requireMinimumRole } from "@/features/auth/authorization";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import type { SearchService } from "@/features/search/search.service";

export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  startReindex = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAdmin(context);
    void auth;
    const result = await this.searchService.startReindex();
    return accepted(context, result, {
      message: "Search reindex has been started.",
    });
  };

  getReindexRun = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAdmin(context);
    void auth;
    const result = await this.searchService.getReindexRun(
      this.requireRouteId(context),
    );
    return ok(context, result ?? { run: null });
  };

  getStatus = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAdmin(context);
    void auth;
    const result = await this.searchService.getStatus();
    return ok(context, result);
  };

  replayDeadLettered = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAdmin(context);
    void auth;
    const url = new URL(context.req.url);
    const limit = this.readPositiveIntQuery(url, "limit", 100);
    const result = await this.searchService.replayDeadLetteredOutbox(limit);
    return accepted(context, result, {
      message: "Dead-lettered search outbox entries are being replayed.",
    });
  };

  cleanupRetainedIndices = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAdmin(context);
    void auth;
    const result = await this.searchService.cleanupRetainedIndices();
    return accepted(context, result, {
      message: "Search index cleanup has been started.",
    });
  };

  private requireRouteId(context: Context<AppBindings>): string {
    return requireSafeRouteParam(context, "id");
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

  private async requireAdmin(context: Context<AppBindings>) {
    const auth = await requireJwtAuth(context);
    requireMinimumRole(auth, "admin");
    return auth;
  }
}
