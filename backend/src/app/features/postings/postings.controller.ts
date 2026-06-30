import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import {
  accepted,
  created,
  mergeResponseMeta,
  noContent,
  ok,
  paginationMeta,
  pickMeta,
} from "@/configuration/http/responses";
import {
  getOptionalJwtAuth,
  requireJwtAuth,
} from "@/configuration/middlewares/jwt-middleware";
import {
  RequestValidationError,
  parseRequestBody,
} from "@/configuration/validation/request";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import { loggerFactory, type Logger } from "@/configuration/logging";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import {
  listPostingAnalyticsQuerySchema,
  postingAnalyticsDetailQuerySchema,
  postingAnalyticsSummaryQuerySchema,
  postingAnalyticsWindowSchema,
  type ListPostingAnalyticsInput,
  type ListPostingAnalyticsQuery,
  type PostingAnalyticsDetailInput,
  type PostingAnalyticsDetailQuery,
  type PostingAnalyticsSummaryQuery,
  type PostingAnalyticsWindow,
} from "@/features/postings/analytics/analytics.model";
import { PostingsAnalyticsService } from "@/features/postings/analytics/analytics.service";
import {
  createPostingReviewRequestSchema,
  listPostingReviewsQuerySchema,
  type CreatePostingReviewRequestBody,
  type ListPostingReviewsQuery,
} from "@/features/postings/reviews/reviews.model";
import { PostingsReviewsService } from "@/features/postings/reviews/reviews.service";
import {
  upsertSeasonalPricingSchema,
  type UpsertSeasonalPricingBody,
} from "@/features/postings/seasonal-pricing/seasonal-pricing.model";
import { SeasonalPricingService } from "@/features/postings/seasonal-pricing/seasonal-pricing.service";
import {
  listOwnerPostingsQuerySchema,
  ownerAvailabilityBlockRequestSchema,
  postingBatchIdsQuerySchema,
  postingResourceIdSchema,
  publicAutocompletePostingsQuerySchema,
  publicSearchPostingsQuerySchema,
  searchAttributeFiltersSchema,
  type ListOwnerPostingsInput,
  type ListOwnerPostingsQuery,
  type OwnerAvailabilityBlockRequestBody,
  type PostingAutocompleteInput,
  type PublicSearchPostingsQuery,
  type PublicAutocompletePostingsQuery,
  type SearchAttributeFilterInput,
  type SearchPostingsInput,
  type UpdatePostingRequestBody,
  type UpsertPostingInput,
  type UpsertPostingRequestBody,
  type PostingRecord,
  type PublicPostingRecord,
  updatePostingRequestSchema,
  upsertPostingRequestSchema,
} from "@/features/postings/postings.model";
import { PostingsService } from "@/features/postings/postings.service";
import { PostingsPublicAutocompleteService } from "@/features/postings/search/autocomplete.service";
import {
  searchClickActivityRequestSchema,
  type SearchClickActivityRequestBody,
} from "@/features/recommendations/recommendation-activity.model";
import type { RecommendationActivityPublisher } from "@/features/recommendations/recommendation-activity.publisher";
import type { AuthPrincipal } from "@/features/auth/auth.principal";

export class PostingsController {
  private readonly logger: Logger;

  constructor(
    private readonly postingsService: PostingsService,
    private readonly postingsPublicAutocompleteService: PostingsPublicAutocompleteService,
    private readonly postingsAnalyticsService: PostingsAnalyticsService,
    private readonly postingsReviewsService: PostingsReviewsService,
    private readonly seasonalPricingService: SeasonalPricingService,
    private readonly recommendationActivityPublisher: RecommendationActivityPublisher,
  ) {
    this.logger = loggerFactory.forClass(PostingsController, "controller");
  }

  create = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(context, upsertPostingRequestSchema);
    const result = await this.postingsService.createDraft(
      auth.sub,
      this.toUpsertInput(body),
    );
    return created(context, result, {
      message: "Posting draft created successfully.",
    });
  };

  update = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(context, updatePostingRequestSchema);
    const result = await this.postingsService.update(
      this.requireRouteId(context),
      auth.sub,
      this.toUpsertInput(body),
    );
    return ok(context, result, {
      message: "Posting updated successfully.",
    });
  };

  duplicate = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.postingsService.duplicate(
      this.requireRouteId(context),
      auth.sub,
    );
    return created(context, result, {
      message: "Posting duplicated successfully.",
    });
  };

  listAvailabilityBlocks = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.postingsService.listOwnerAvailabilityBlocks(
      this.requireRouteId(context),
      auth.sub,
    );
    return ok(context, result);
  };

  createAvailabilityBlock = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(
      context,
      ownerAvailabilityBlockRequestSchema,
    );
    const result = await this.postingsService.createOwnerAvailabilityBlock(
      this.requireRouteId(context),
      auth.sub,
      this.toAvailabilityBlockInput(body),
    );
    return created(context, result, {
      message: "Availability block created successfully.",
    });
  };

  updateAvailabilityBlock = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(
      context,
      ownerAvailabilityBlockRequestSchema,
    );
    const result = await this.postingsService.updateOwnerAvailabilityBlock(
      this.requireRouteId(context),
      auth.sub,
      this.requireRouteParam(context, "blockId"),
      this.toAvailabilityBlockInput(body),
    );
    return ok(context, result, {
      message: "Availability block updated successfully.",
    });
  };

  deleteAvailabilityBlock = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    await this.postingsService.deleteOwnerAvailabilityBlock(
      this.requireRouteId(context),
      auth.sub,
      this.requireRouteParam(context, "blockId"),
    );
    return noContent();
  };

  publish = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.postingsService.publish(
      this.requireRouteId(context),
      auth.sub,
    );
    await this.recommendationActivityPublisher.publishPostingLifecycle({
      posting: result,
      eventType: "posting_published",
      client: context.get("client"),
      requestId: this.readRequestId(context),
      actorUserId: auth.sub,
    });
    return ok(context, result, {
      message: "Posting published successfully.",
    });
  };

  archive = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.postingsService.archive(
      this.requireRouteId(context),
      auth.sub,
    );
    await this.recommendationActivityPublisher.publishPostingLifecycle({
      posting: result,
      eventType: "posting_archived",
      client: context.get("client"),
      requestId: this.readRequestId(context),
      actorUserId: auth.sub,
    });
    return ok(context, result, {
      message: "Posting archived successfully.",
    });
  };

  pause = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.postingsService.pause(
      this.requireRouteId(context),
      auth.sub,
    );
    await this.recommendationActivityPublisher.publishPostingLifecycle({
      posting: result,
      eventType: "posting_paused",
      client: context.get("client"),
      requestId: this.readRequestId(context),
      actorUserId: auth.sub,
    });
    return ok(context, result, {
      message: "Posting paused successfully.",
    });
  };

  unpause = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.postingsService.unpause(
      this.requireRouteId(context),
      auth.sub,
    );
    await this.recommendationActivityPublisher.publishPostingLifecycle({
      posting: result,
      eventType: "posting_unpaused",
      client: context.get("client"),
      requestId: this.readRequestId(context),
      actorUserId: auth.sub,
    });
    return ok(context, result, {
      message: "Posting unpaused successfully.",
    });
  };

  getById = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.getOptionalAuth(context);
    const result = await this.postingsService.getById(
      this.requireRouteId(context),
      auth?.sub,
    );

    if (!auth || !this.isManagedPostingRecord(result)) {
      await this.postingsAnalyticsService.trackPublicView(
        result,
        context.get("client"),
        auth?.sub,
      );
      await this.recommendationActivityPublisher.publishPostingView({
        posting: result,
        client: context.get("client"),
        requestId: this.readRequestId(context),
        actorUserId: auth?.sub,
      });
    }

    return ok(context, result);
  };

  trackSearchClick = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.getOptionalAuth(context);
    const body = await parseRequestBody(
      context,
      searchClickActivityRequestSchema,
    );

    await this.postingsAnalyticsService.trackSearchClick(
      this.requireRouteId(context),
      auth?.sub,
    );
    await this.recommendationActivityPublisher.publishSearchClick({
      postingId: this.requireRouteId(context),
      client: context.get("client"),
      body: this.toSearchClickActivityRequest(body),
      requestId: this.readRequestId(context),
      actorUserId: auth?.sub,
    });

    return accepted(
      context,
      {
        accepted: true,
      },
      {
        message: "Posting search click tracked successfully.",
      },
    );
  };

  listMine = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.postingsService.listByOwner(
      auth.sub,
      this.parseListOwnerPostingsInput(context),
    );
    return ok(context, result, {
      meta: paginationMeta(result),
    });
  };

  batchMine = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.postingsService.batchByOwner(
      auth.sub,
      this.parseBatchIds(context),
    );
    return ok(context, result);
  };

  batchPublic = async (context: Context<AppBindings>): Promise<Response> => {
    const result = await this.postingsService.batchPublic(
      this.parseBatchIds(context),
    );
    return ok(context, result);
  };

  search = async (context: Context<AppBindings>): Promise<Response> => {
    const result = await this.postingsService.searchPublic(
      this.parseSearchPostingsInput(context),
    );
    void this.postingsAnalyticsService
      .trackSearchImpressions(result.postings)
      .catch((error) => {
        this.logger.warn(
          "Failed to record posting search impressions.",
          undefined,
          error,
        );
      });
    return ok(context, result, {
      meta: mergeResponseMeta(
        paginationMeta(result),
        pickMeta(result, ["source"]),
      ),
    });
  };

  autocomplete = async (context: Context<AppBindings>): Promise<Response> => {
    const result =
      await this.postingsPublicAutocompleteService.autocompletePublic(
        this.parseAutocompletePostingsInput(context),
      );
    return ok(context, result);
  };

  analyticsSummary = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const query = this.parseAnalyticsSummaryQuery(context);
    const result = await this.postingsAnalyticsService.getOwnerSummary(
      auth.sub,
      query.window,
    );
    return ok(context, result);
  };

  analyticsPostings = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const input = this.parseListPostingAnalyticsInput(context, auth.sub);
    const result =
      await this.postingsAnalyticsService.listOwnerPostingsAnalytics(input);
    return ok(context, result, {
      meta: paginationMeta(result),
    });
  };

  analyticsById = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const input = this.parsePostingAnalyticsDetailInput(
      context,
      auth.sub,
      this.requireRouteId(context),
    );
    const result =
      await this.postingsAnalyticsService.getPostingAnalyticsDetail(input);
    return ok(context, result);
  };

  exportAnalytics = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const url = new URL(context.req.url);
    let window: PostingAnalyticsWindow;
    try {
      window = postingAnalyticsWindowSchema.parse(
        url.searchParams.get("window") ?? "30d",
      );
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
    const csv = await this.postingsAnalyticsService.exportAsCsv(
      auth.sub,
      window,
    );
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="analytics.csv"',
      },
    });
  };

  listReviews = async (context: Context<AppBindings>): Promise<Response> => {
    const { page, pageSize } = this.parseListPostingReviewsQuery(context);
    const result = await this.postingsReviewsService.list(
      this.requireRouteId(context),
      page,
      pageSize,
    );
    return ok(context, result, {
      meta: paginationMeta(result),
    });
  };

  createReview = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(
      context,
      createPostingReviewRequestSchema,
    );
    const result = await this.postingsReviewsService.create(
      this.requireRouteId(context),
      auth.sub,
      body,
    );
    return created(context, result, {
      message: "Review created successfully.",
    });
  };

  updateOwnReview = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(
      context,
      createPostingReviewRequestSchema,
    );
    const result = await this.postingsReviewsService.updateOwn(
      this.requireRouteId(context),
      auth.sub,
      body,
    );
    return ok(context, result, {
      message: "Review updated successfully.",
    });
  };

  listSeasonalPricing = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const rules = await this.seasonalPricingService.list(
      this.requireRouteId(context),
      auth.sub,
    );
    return ok(context, rules);
  };

  createSeasonalPricingRule = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(context, upsertSeasonalPricingSchema);
    const rule = await this.seasonalPricingService.create(
      this.requireRouteId(context),
      auth.sub,
      body,
    );
    return created(context, rule, {
      message: "Seasonal pricing rule created successfully.",
    });
  };

  updateSeasonalPricingRule = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(context, upsertSeasonalPricingSchema);
    const ruleId = requireSafeRouteParam(context, "ruleId");
    const rule = await this.seasonalPricingService.update(
      this.requireRouteId(context),
      ruleId,
      auth.sub,
      body,
    );
    return ok(context, rule, {
      message: "Seasonal pricing rule updated successfully.",
    });
  };

  deleteSeasonalPricingRule = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const ruleId = requireSafeRouteParam(context, "ruleId");
    await this.seasonalPricingService.delete(
      this.requireRouteId(context),
      ruleId,
      auth.sub,
    );
    return noContent(context);
  };

  private toUpsertInput(
    body: UpsertPostingRequestBody | UpdatePostingRequestBody,
  ): UpsertPostingInput {
    const availabilityBlocks =
      "availabilityBlocks" in body ? body.availabilityBlocks : [];

    return {
      organizationId: "",
      variant: body.variant,
      name: body.name,
      description: body.description,
      pricing: body.pricing,
      photos: body.photos,
      tags: body.tags,
      details: body.details,
      availabilityStatus: body.availabilityStatus,
      availabilityNotes: body.availabilityNotes ?? null,
      maxBookingDurationDays: body.maxBookingDurationDays ?? null,
      minBookingDurationDays: body.minBookingDurationDays ?? null,
      advanceNoticeDays: body.advanceNoticeDays ?? null,
      cancellationPolicy: body.cancellationPolicy ?? null,
      cancellationPolicyNotes: body.cancellationPolicyNotes ?? null,
      instantBooking: body.instantBooking ?? false,
      availabilityBlocks,
      location: {
        latitude: body.location.latitude,
        longitude: body.location.longitude,
        city: body.location.city,
        region: body.location.region,
        country: body.location.country,
        postalCode: body.location.postalCode ?? undefined,
      },
    };
  }

  private toAvailabilityBlockInput(body: OwnerAvailabilityBlockRequestBody) {
    return {
      startAt: body.startAt,
      endAt: body.endAt,
      note: body.note ?? undefined,
    };
  }

  private toSearchClickActivityRequest(
    body: SearchClickActivityRequestBody,
  ): SearchClickActivityRequestBody {
    return body;
  }

  private parseListOwnerPostingsInput(
    context: Context<AppBindings>,
  ): Omit<ListOwnerPostingsInput, "organizationId"> {
    const url = new URL(context.req.url);

    try {
      const query = listOwnerPostingsQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      });

      return this.toListOwnerPostingsInput(query);
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parseSearchPostingsInput(
    context: Context<AppBindings>,
  ): SearchPostingsInput {
    const url = new URL(context.req.url);

    try {
      const query = publicSearchPostingsQuerySchema.parse({
        page: this.readOptionalQueryParam(url.searchParams, "page"),
        pageSize: this.readOptionalQueryParam(url.searchParams, "pageSize"),
        q: this.readOptionalQueryParam(url.searchParams, "q"),
        family: this.readOptionalQueryParam(url.searchParams, "family"),
        subtype: this.readOptionalQueryParam(url.searchParams, "subtype"),
        tags: this.readArrayQuery(url.searchParams, "tags"),
        availabilityStatus: this.readOptionalQueryParam(
          url.searchParams,
          "availabilityStatus",
        ),
        minDailyPrice: this.readOptionalQueryParam(
          url.searchParams,
          "minDailyPrice",
        ),
        maxDailyPrice: this.readOptionalQueryParam(
          url.searchParams,
          "maxDailyPrice",
        ),
        latitude: this.readOptionalQueryParam(url.searchParams, "latitude"),
        longitude: this.readOptionalQueryParam(url.searchParams, "longitude"),
        radiusKm: this.readOptionalQueryParam(url.searchParams, "radiusKm"),
        startAt: this.readOptionalQueryParam(url.searchParams, "startAt"),
        endAt: this.readOptionalQueryParam(url.searchParams, "endAt"),
        sort: this.readOptionalQueryParam(url.searchParams, "sort"),
      });
      const attributeFilters = this.readAttributeFilters(url.searchParams);

      return this.toSearchPostingsInput(query, attributeFilters);
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parseListPostingReviewsQuery(
    context: Context<AppBindings>,
  ): ListPostingReviewsQuery {
    const url = new URL(context.req.url);

    try {
      return listPostingReviewsQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
      });
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parseAnalyticsSummaryQuery(
    context: Context<AppBindings>,
  ): PostingAnalyticsSummaryQuery {
    const url = new URL(context.req.url);

    try {
      return postingAnalyticsSummaryQuerySchema.parse({
        window: url.searchParams.get("window") ?? undefined,
      });
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parseListPostingAnalyticsInput(
    context: Context<AppBindings>,
    actorUserId: string,
  ): ListPostingAnalyticsInput {
    const url = new URL(context.req.url);

    try {
      const query = listPostingAnalyticsQuerySchema.parse({
        window: url.searchParams.get("window") ?? undefined,
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
      });

      return this.toListPostingAnalyticsInput(actorUserId, query);
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parsePostingAnalyticsDetailInput(
    context: Context<AppBindings>,
    actorUserId: string,
    postingId: string,
  ): PostingAnalyticsDetailInput {
    const url = new URL(context.req.url);

    try {
      const query = postingAnalyticsDetailQuerySchema.parse({
        window: url.searchParams.get("window") ?? undefined,
        granularity: url.searchParams.get("granularity") ?? undefined,
      });

      return this.toPostingAnalyticsDetailInput(actorUserId, postingId, query);
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private toListOwnerPostingsInput(
    query: ListOwnerPostingsQuery,
  ): Omit<ListOwnerPostingsInput, "organizationId"> {
    return {
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    };
  }

  private toSearchPostingsInput(
    query: PublicSearchPostingsQuery,
    attributeFilters?: SearchAttributeFilterInput[],
  ): SearchPostingsInput {
    return {
      page: query.page,
      pageSize: query.pageSize,
      query: query.q,
      family: query.family,
      subtype: query.subtype,
      tags: query.tags && query.tags.length > 0 ? query.tags : undefined,
      availabilityStatus: query.availabilityStatus,
      minDailyPrice: query.minDailyPrice,
      maxDailyPrice: query.maxDailyPrice,
      geo:
        query.latitude !== undefined && query.longitude !== undefined
          ? {
              latitude: query.latitude,
              longitude: query.longitude,
              radiusKm: query.radiusKm,
            }
          : undefined,
      availabilityWindow:
        query.startAt !== undefined && query.endAt !== undefined
          ? {
              startAt: query.startAt,
              endAt: query.endAt,
            }
          : undefined,
      attributeFilters,
      sort: query.sort,
      cancellationPolicy: query.cancellationPolicy,
      instantBooking: query.instantBooking,
      maxMinBookingDurationDays: query.maxMinBookingDurationDays,
    };
  }

  private toAutocompletePostingsInput(
    query: PublicAutocompletePostingsQuery,
  ): PostingAutocompleteInput {
    return {
      query: query.q,
      family: query.family,
      subtype: query.subtype,
      limit: query.limit,
    };
  }

  private readAttributeFilters(
    searchParams: URLSearchParams,
  ): SearchAttributeFilterInput[] | undefined {
    const filters = new Map<
      string,
      {
        values: Array<string>;
        min?: number;
        max?: number;
      }
    >();

    for (const [key, rawValue] of searchParams.entries()) {
      if (!key.startsWith("attr.")) {
        continue;
      }

      const attributeKey = key.slice("attr.".length);
      let targetKey = attributeKey;
      let bound: "min" | "max" | null = null;

      if (attributeKey.endsWith(".min")) {
        targetKey = attributeKey.slice(0, -4);
        bound = "min";
      } else if (attributeKey.endsWith(".max")) {
        targetKey = attributeKey.slice(0, -4);
        bound = "max";
      }

      const filter = filters.get(targetKey) ?? { values: [] };
      const value = rawValue.trim();

      if (!value) {
        continue;
      }

      if (bound) {
        const parsed = Number(value);

        if (!Number.isFinite(parsed)) {
          throw new RequestValidationError("Request query validation failed.", [
            {
              path: key,
              message: "Attribute range values must be valid numbers.",
            },
          ]);
        }

        filter[bound] = parsed;
      } else {
        filter.values.push(value);
      }

      filters.set(targetKey, filter);
    }

    if (filters.size === 0) {
      return undefined;
    }

    return searchAttributeFiltersSchema.parse(
      Array.from(filters.entries()).map(([key, filter]) => ({
        key,
        ...(filter.values.length === 0
          ? {}
          : {
              value:
                filter.values.length === 1 ? filter.values[0] : filter.values,
            }),
        ...(filter.min !== undefined ? { min: filter.min } : {}),
        ...(filter.max !== undefined ? { max: filter.max } : {}),
      })),
    );
  }

  private toListPostingAnalyticsInput(
    actorUserId: string,
    query: ListPostingAnalyticsQuery,
  ): ListPostingAnalyticsInput {
    return {
      actorUserId,
      organizationId: "",
      window: query.window,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private toPostingAnalyticsDetailInput(
    actorUserId: string,
    postingId: string,
    query: PostingAnalyticsDetailQuery,
  ): PostingAnalyticsDetailInput {
    return {
      actorUserId,
      organizationId: "",
      postingId,
      window: query.window,
      granularity: query.granularity,
    };
  }

  private parseBatchIds(context: Context<AppBindings>): string[] {
    const url = new URL(context.req.url);
    try {
      return postingBatchIdsQuerySchema.parse(
        this.readArrayQuery(url.searchParams, "ids"),
      );
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parseAutocompletePostingsInput(
    context: Context<AppBindings>,
  ): PostingAutocompleteInput {
    const url = new URL(context.req.url);

    try {
      const query = publicAutocompletePostingsQuerySchema.parse({
        q: this.readOptionalQueryParam(url.searchParams, "q"),
        family: this.readOptionalQueryParam(url.searchParams, "family"),
        subtype: this.readOptionalQueryParam(url.searchParams, "subtype"),
        limit: this.readOptionalQueryParam(url.searchParams, "limit"),
      });

      return this.toAutocompletePostingsInput(query);
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private readArrayQuery(searchParams: URLSearchParams, key: string): string[] {
    return searchParams
      .getAll(key)
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private readOptionalQueryParam(
    searchParams: URLSearchParams,
    key: string,
  ): string | undefined {
    const value = searchParams.get(key);

    if (value === null) {
      return undefined;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : undefined;
  }

  private requireRouteId(context: Context<AppBindings>): string {
    return this.requireRouteParam(context, "id");
  }

  private requireRouteParam(
    context: Context<AppBindings>,
    name: string,
  ): string {
    const value = requireSafeRouteParam(context, name);

    try {
      return postingResourceIdSchema.parse(value);
    } catch (error) {
      if ("issues" in (error as object)) {
        const issues =
          (error as { issues?: Array<{ message: string }> }).issues ?? [];

        throw new RequestValidationError(
          "Route parameter validation failed.",
          issues.map((issue) => ({
            path: name,
            message: issue.message,
          })),
        );
      }

      throw error;
    }
  }

  private async requireAuth(
    context: Context<AppBindings>,
  ): Promise<AuthPrincipal> {
    return requireJwtAuth(context);
  }

  private async getOptionalAuth(
    context: Context<AppBindings>,
  ): Promise<AuthPrincipal | null> {
    return getOptionalJwtAuth(context);
  }

  private readRequestId(context: Context<AppBindings>): string | undefined {
    return context.get("requestId");
  }

  private isManagedPostingRecord(
    result: PostingRecord | PublicPostingRecord,
  ): result is PostingRecord {
    return "organizationId" in result;
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
