import type { Request, Response } from "express";
import { getQuery } from "@/configuration/http/request";
import { created, ok, paginationMeta } from "@/configuration/http/responses";
import {
  parseRequestBody,
  parseRequestBodyWithRichText,
} from "@/configuration/validation/request";
import {
  requireAuth,
  requireOrganizationId,
  requireResourceId,
  requireRouteValue,
} from "@/features/organizations/organizations.request-helpers";
import {
  createOrganizationBlogSchema,
  listOrganizationBlogQuerySchema,
  listPublicBlogFeedQuerySchema,
  listPublicOrganizationBlogQuerySchema,
  organizationBlogSlugSchema,
  updateOrganizationBlogSchema,
} from "@/features/organizations/blog/blog.model";
import { OrganizationBlogService } from "@/features/organizations/blog/blog.service";
import { asUuid } from "@/configuration/validation/uuid";

export class OrganizationBlogController {
  constructor(private readonly blogService: OrganizationBlogService) {}

  list = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const query = listOrganizationBlogQuerySchema.parse(getQuery(request));
    const result = await this.blogService.list({
      ...query,
      organizationId: asUuid(requireOrganizationId(request)),
      actorUserId: asUuid(auth.sub),
    });
    ok(response, result, { meta: paginationMeta(result) });
  };

  create = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const body = await parseRequestBodyWithRichText(
      request,
      createOrganizationBlogSchema,
      ["body"],
    );
    const result = await this.blogService.create({
      organizationId: asUuid(requireOrganizationId(request)),
      actorUserId: asUuid(auth.sub),
      ...body,
    });
    created(response, result, {
      message: "Organization blog post created successfully.",
    });
  };

  update = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const body = await parseRequestBodyWithRichText(
      request,
      updateOrganizationBlogSchema,
      ["body"],
    );
    const result = await this.blogService.update({
      organizationId: asUuid(requireOrganizationId(request)),
      actorUserId: asUuid(auth.sub),
      blogPostId: asUuid(requireResourceId(request, "blogPostId")),
      ...body,
    });
    ok(response, result, {
      message: "Organization blog post updated successfully.",
    });
  };

  delete = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const result = await this.blogService.delete({
      organizationId: asUuid(requireOrganizationId(request)),
      actorUserId: asUuid(auth.sub),
      blogPostId: asUuid(requireResourceId(request, "blogPostId")),
    });
    ok(response, result, {
      message: "Organization blog post deleted successfully.",
    });
  };

  listPublished = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = listPublicOrganizationBlogQuerySchema.parse(
      getQuery(request),
    );
    const result = await this.blogService.listPublished({
      ...query,
      organizationId: asUuid(requireOrganizationId(request)),
    });
    ok(response, result, { meta: paginationMeta(result) });
  };

  getPublished = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const result = await this.blogService.getPublishedBySlug({
      organizationId: asUuid(requireOrganizationId(request)),
      slug: requireRouteValue(
        request,
        "slug",
        organizationBlogSlugSchema,
        "Route parameter validation failed.",
      ),
    });
    ok(response, result);
  };

  // Public, cross-organization published blog feed/search (Elasticsearch-backed).
  searchGlobal = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = listPublicBlogFeedQuerySchema.parse(getQuery(request));
    const result = await this.blogService.searchGlobal(query);
    ok(response, result, { meta: paginationMeta(result) });
  };
}
