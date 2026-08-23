import type { Request, Response } from "express";
import { environment } from "@/configuration/environment";
import { getQuery, writeCookie } from "@/configuration/http/request";
import { created, ok, paginationMeta } from "@/configuration/http/responses";
import ForbiddenError from "@/errors/http/forbidden.error";
import {
  getOptionalJwtAuth,
  requireJwtAuth,
} from "@/configuration/middlewares/jwt-middleware";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import {
  RequestValidationError,
  parseRequestBody,
} from "@/configuration/validation/request";
import type { ListBlogCommentsQuery } from "@/features/organizations/blog/comments/comments.model";
import {
  BLOG_COMMENT_SOCKET_COOKIE_NAME,
  BLOG_COMMENT_SOCKET_PATH,
  createBlogCommentSchema,
  listBlogCommentsQuerySchema,
  updateBlogCommentSchema,
} from "@/features/organizations/blog/comments/comments.model";
import type { OrganizationBlogCommentsService } from "@/features/organizations/blog/comments/comments.service";

export class OrganizationBlogCommentsController {
  constructor(
    private readonly organizationBlogCommentsService: OrganizationBlogCommentsService,
  ) {}

  /**
   * Optional auth: reading is public, but a signed-in reader gets their own
   * capabilities back in the envelope.
   */
  list = async (request: Request, response: Response): Promise<void> => {
    const auth = await getOptionalJwtAuth(request);
    const query = this.parseListQuery(request);
    const result = await this.organizationBlogCommentsService.list({
      organizationId: this.requireOrganizationId(request),
      slug: this.requireSlug(request),
      actorUserId: auth?.sub ?? null,
      page: query.page,
      pageSize: query.pageSize,
    });

    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  create = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const body = await parseRequestBody(request, createBlogCommentSchema);
    const result = await this.organizationBlogCommentsService.create({
      organizationId: this.requireOrganizationId(request),
      slug: this.requireSlug(request),
      actorUserId: auth.sub,
      body: body.body,
    });

    created(response, result, {
      message: "Comment posted successfully.",
    });
  };

  update = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const body = await parseRequestBody(request, updateBlogCommentSchema);
    const result = await this.organizationBlogCommentsService.update({
      organizationId: this.requireOrganizationId(request),
      slug: this.requireSlug(request),
      commentId: this.requireCommentId(request),
      actorUserId: auth.sub,
      body: body.body,
    });

    ok(response, result, { message: "Comment updated successfully." });
  };

  remove = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const result = await this.organizationBlogCommentsService.softDelete({
      organizationId: this.requireOrganizationId(request),
      slug: this.requireSlug(request),
      commentId: this.requireCommentId(request),
      actorUserId: auth.sub,
    });

    ok(response, result, { message: "Comment removed successfully." });
  };

  socketTicket = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    // Optional rather than required: an anonymous reader gets a read-only
    // ticket, which is what lets them receive comments live.
    const auth = await getOptionalJwtAuth(request);

    // A personal access token authenticates a script, not a browser session,
    // and must not be exchangeable for a long-lived connection. Rejected rather
    // than silently downgraded to anonymous, which would be a surprising way to
    // lose write access.
    if (auth && auth.authMethod !== "jwt") {
      throw new ForbiddenError(
        "This endpoint requires a signed-in user session.",
      );
    }

    const result =
      await this.organizationBlogCommentsService.createSocketTicket(
        this.requireOrganizationId(request),
        this.requireSlug(request),
        {
          userId: auth?.sub ?? null,
          // Recorded so the socket can be re-checked against this session
          // later. The claim bag is loosely typed, so both fields are narrowed
          // rather than asserted.
          sessionId:
            auth && typeof auth.sessionId === "string" ? auth.sessionId : null,
          tokenVersion:
            auth && typeof auth.tokenVersion === "number"
              ? auth.tokenVersion
              : null,
        },
      );

    // The ticket rides in an HttpOnly cookie rather than the response body or a
    // query parameter: a browser `WebSocket` cannot set headers, and the query
    // string is visible to proxies and access logs. Scoping the path keeps it
    // off every other request to this origin.
    writeCookie(response, BLOG_COMMENT_SOCKET_COOKIE_NAME, result.ticket, {
      path: BLOG_COMMENT_SOCKET_PATH,
      httpOnly: true,
      secure: environment.isProduction(),
      sameSite: "Lax",
      maxAge: result.expiresInSeconds,
    });

    created(
      response,
      { expiresInSeconds: result.expiresInSeconds },
      { message: "Socket ticket issued successfully." },
    );
  };

  private requireOrganizationId(request: Request): string {
    return requireSafeRouteParam(request, "id");
  }

  private requireSlug(request: Request): string {
    return requireSafeRouteParam(request, "slug");
  }

  private requireCommentId(request: Request): string {
    return requireSafeRouteParam(request, "commentId");
  }

  private parseListQuery(request: Request): ListBlogCommentsQuery {
    // `getQuery` flattens repeated keys to one value each: the schema coerces
    // numbers, and an array would coerce to NaN rather than fail cleanly.
    const query = getQuery(request);

    try {
      return listBlogCommentsQuerySchema.parse({
        page: query.page,
        pageSize: query.pageSize,
      });
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private toValidationError(
    error: unknown,
    message: string,
  ): RequestValidationError {
    if ("issues" in (error as object)) {
      const issues = (
        error as { issues?: Array<{ path: PropertyKey[]; message: string }> }
      ).issues;

      return new RequestValidationError(
        message,
        (issues ?? []).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }

    throw error;
  }
}
