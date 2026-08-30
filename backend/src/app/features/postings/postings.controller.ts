import type { Request, Response } from "express";
import { getRequestUrl } from "@/configuration/http/request";
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
  listSavedPostingsQuerySchema,
  type ListSavedPostingsQuery,
} from "@/features/postings/saved/saved-postings.model";
import { SavedPostingsService } from "@/features/postings/saved/saved-postings.service";
import {
  upsertSeasonalPricingSchema,
  type UpsertSeasonalPricingBody,
} from "@/features/postings/seasonal-pricing/seasonal-pricing.model";
import { SeasonalPricingService } from "@/features/postings/seasonal-pricing/seasonal-pricing.service";
import {
  availabilityCalendarQuerySchema,
  listOwnerPostingsQuerySchema,
  ownerAvailabilityBlockRequestSchema,
  postingBatchIdsQuerySchema,
  postingResourceIdSchema,
  publicAutocompletePostingsQuerySchema,
  publicSearchPostingsQuerySchema,
  searchAttributeFiltersSchema,
  type AvailabilityCalendarQuery,
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
import { asOptionalUuid, asUuid, type Uuid } from "@/configuration/validation/uuid";

export class PostingsController {
  private readonly logger: Logger;

  constructor(
    private readonly postingsService: PostingsService,
    private readonly postingsPublicAutocompleteService: PostingsPublicAutocompleteService,
    private readonly postingsAnalyticsService: PostingsAnalyticsService,
    private readonly postingsReviewsService: PostingsReviewsService,
    private readonly seasonalPricingService: SeasonalPricingService,
    private readonly recommendationActivityPublisher: RecommendationActivityPublisher,
    private readonly savedPostingsService: SavedPostingsService,
  ) {
    this.logger = loggerFactory.forClass(PostingsController, "controller");
  }

  create = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, upsertPostingRequestSchema);
    const result = await this.postingsService.createDraft(
      auth.sub,
      this.toUpsertInput(body),
    );
    created(response, result, {
      message: "Posting draft created successfully.",
    });
  };

  update = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, updatePostingRequestSchema);
    const result = await this.postingsService.update(
      this.requireRouteId(request),
      auth.sub,
      this.toUpsertInput(body),
    );
    ok(response, result, {
      message: "Posting updated successfully.",
    });
  };

  duplicate = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.postingsService.duplicate(
      this.requireRouteId(request),
      auth.sub,
    );
    created(response, result, {
      message: "Posting duplicated successfully.",
    });
  };

  listAvailabilityBlocks = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.postingsService.listOwnerAvailabilityBlocks(
      this.requireRouteId(request),
      auth.sub,
    );
    ok(response, result);
  };

  createAvailabilityBlock = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      ownerAvailabilityBlockRequestSchema,
    );
    const result = await this.postingsService.createOwnerAvailabilityBlock(
      this.requireRouteId(request),
      auth.sub,
      this.toAvailabilityBlockInput(body),
    );
    created(response, result, {
      message: "Availability block created successfully.",
    });
  };

  updateAvailabilityBlock = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      ownerAvailabilityBlockRequestSchema,
    );
    const result = await this.postingsService.updateOwnerAvailabilityBlock(
      this.requireRouteId(request),
      auth.sub,
      this.requireRouteParam(request, "blockId"),
      this.toAvailabilityBlockInput(body),
    );
    ok(response, result, {
      message: "Availability block updated successfully.",
    });
  };

  deleteAvailabilityBlock = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    await this.postingsService.deleteOwnerAvailabilityBlock(
      this.requireRouteId(request),
      auth.sub,
      this.requireRouteParam(request, "blockId"),
    );
    noContent(response);
  };

  publish = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.postingsService.publish(
      this.requireRouteId(request),
      auth.sub,
    );
    await this.recommendationActivityPublisher.publishPostingLifecycle({
      posting: result,
      eventType: "posting_published",
      client: request.client,
      requestId: this.readRequestId(request),
      actorUserId: asUuid(auth.sub),
    });
    ok(response, result, {
      message: "Posting published successfully.",
    });
  };

  archive = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.postingsService.archive(
      this.requireRouteId(request),
      auth.sub,
    );
    await this.recommendationActivityPublisher.publishPostingLifecycle({
      posting: result,
      eventType: "posting_archived",
      client: request.client,
      requestId: this.readRequestId(request),
      actorUserId: asUuid(auth.sub),
    });
    ok(response, result, {
      message: "Posting archived successfully.",
    });
  };

  pause = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.postingsService.pause(
      this.requireRouteId(request),
      auth.sub,
    );
    await this.recommendationActivityPublisher.publishPostingLifecycle({
      posting: result,
      eventType: "posting_paused",
      client: request.client,
      requestId: this.readRequestId(request),
      actorUserId: asUuid(auth.sub),
    });
    ok(response, result, {
      message: "Posting paused successfully.",
    });
  };

  unpause = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.postingsService.unpause(
      this.requireRouteId(request),
      auth.sub,
    );
    await this.recommendationActivityPublisher.publishPostingLifecycle({
      posting: result,
      eventType: "posting_unpaused",
      client: request.client,
      requestId: this.readRequestId(request),
      actorUserId: asUuid(auth.sub),
    });
    ok(response, result, {
      message: "Posting unpaused successfully.",
    });
  };

  getById = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.getOptionalAuth(request);
    const result = await this.postingsService.getById(
      this.requireRouteId(request),
      auth?.sub,
    );

    if (!auth || !this.isManagedPostingRecord(result)) {
      await this.postingsAnalyticsService.trackPublicView(
        result,
        request.client,
        auth?.sub,
      );
      await this.recommendationActivityPublisher.publishPostingView({
        posting: result,
        client: request.client,
        requestId: this.readRequestId(request),
        actorUserId: asOptionalUuid(auth?.sub),
      });
    }

    ok(response, result);
  };

  getAvailabilityCalendar = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.getOptionalAuth(request);
    const query = this.parseAvailabilityCalendarQuery(request);
    const result = await this.postingsService.getAvailabilityCalendar(
      this.requireRouteId(request),
      query,
      auth?.sub,
    );

    ok(response, result);
  };

  trackSearchClick = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.getOptionalAuth(request);
    const body = await parseRequestBody(
      request,
      searchClickActivityRequestSchema,
    );

    await this.postingsAnalyticsService.trackSearchClick(
      this.requireRouteId(request),
      auth?.sub,
    );
    await this.recommendationActivityPublisher.publishSearchClick({
      postingId: asUuid(this.requireRouteId(request)),
      client: request.client,
      body: this.toSearchClickActivityRequest(body),
      requestId: this.readRequestId(request),
      actorUserId: asOptionalUuid(auth?.sub),
    });

    accepted(
      response,
      {
        accepted: true,
      },
      {
        message: "Posting search click tracked successfully.",
      },
    );
  };

  listMine = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.postingsService.listByOwner(
      auth.sub,
      this.parseListOwnerPostingsInput(request),
    );
    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  statusSummary = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.postingsService.getOwnerStatusSummary(auth.sub);
    ok(response, result);
  };

  batchMine = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.postingsService.batchByOwner(
      auth.sub,
      this.parseBatchIds(request),
    );
    ok(response, result);
  };

  batchPublic = async (request: Request, response: Response): Promise<void> => {
    const result = await this.postingsService.batchPublic(
      this.parseBatchIds(request),
    );
    ok(response, result);
  };

  search = async (request: Request, response: Response): Promise<void> => {
    const result = await this.postingsService.searchPublic(
      this.parseSearchPostingsInput(request),
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
    ok(response, result, {
      meta: mergeResponseMeta(
        paginationMeta(result),
        pickMeta(result, ["source"]),
      ),
    });
  };

  autocomplete = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const result =
      await this.postingsPublicAutocompleteService.autocompletePublic(
        this.parseAutocompletePostingsInput(request),
      );
    ok(response, result);
  };

  analyticsSummary = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const query = this.parseAnalyticsSummaryQuery(request);
    const result = await this.postingsAnalyticsService.getOwnerSummary(
      auth.sub,
      query.window,
    );
    ok(response, result);
  };

  analyticsPostings = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const input = this.parseListPostingAnalyticsInput(request, auth.sub);
    const result =
      await this.postingsAnalyticsService.listOwnerPostingsAnalytics(input);
    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  analyticsById = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const input = this.parsePostingAnalyticsDetailInput(
      request,
      auth.sub,
      this.requireRouteId(request),
    );
    const result =
      await this.postingsAnalyticsService.getPostingAnalyticsDetail(input);
    ok(response, result);
  };

  exportAnalytics = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const url = getRequestUrl(request);
    let window: PostingAnalyticsWindow;
    try {
      window = postingAnalyticsWindowSchema.parse(
        url.searchParams.get("window") ?? "7d",
      );
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
    const csv = await this.postingsAnalyticsService.exportAsCsv(
      auth.sub,
      window,
    );
    // Written directly rather than through res.send so the content type is
    // sent exactly as declared.
    response.status(200);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="analytics.csv"',
    );
    response.end(csv);
  };

  listReviews = async (request: Request, response: Response): Promise<void> => {
    const { page, pageSize } = this.parseListPostingReviewsQuery(request);
    const result = await this.postingsReviewsService.list(
      this.requireRouteId(request),
      page,
      pageSize,
    );
    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  getOwnReview = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.postingsReviewsService.getOwn(
      this.requireRouteId(request),
      auth.sub,
    );
    ok(response, result);
  };

  createReview = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      createPostingReviewRequestSchema,
    );
    const result = await this.postingsReviewsService.create(
      this.requireRouteId(request),
      auth.sub,
      body,
    );
    created(response, result, {
      message: "Review created successfully.",
    });
  };

  updateOwnReview = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      createPostingReviewRequestSchema,
    );
    const result = await this.postingsReviewsService.updateOwn(
      this.requireRouteId(request),
      auth.sub,
      body,
    );
    ok(response, result, {
      message: "Review updated successfully.",
    });
  };

  listSaved = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const query = this.parseListSavedPostingsQuery(request);
    const result = await this.savedPostingsService.list(
      auth.sub,
      query.page,
      query.pageSize,
    );
    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  listSavedIds = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.savedPostingsService.listIds(auth.sub);
    ok(response, result);
  };

  save = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.savedPostingsService.save(
      this.requireRouteId(request),
      auth.sub,
    );
    ok(response, result, {
      message: "Posting saved successfully.",
    });
  };

  unsave = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.savedPostingsService.unsave(
      this.requireRouteId(request),
      auth.sub,
    );
    ok(response, result, {
      message: "Posting removed from saved postings.",
    });
  };

  listSeasonalPricing = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const rules = await this.seasonalPricingService.list(
      this.requireRouteId(request),
      auth.sub,
    );
    ok(response, rules);
  };

  createSeasonalPricingRule = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, upsertSeasonalPricingSchema);
    const rule = await this.seasonalPricingService.create(
      this.requireRouteId(request),
      auth.sub,
      body,
    );
    created(response, rule, {
      message: "Seasonal pricing rule created successfully.",
    });
  };

  updateSeasonalPricingRule = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, upsertSeasonalPricingSchema);
    const ruleId = requireSafeRouteParam(request, "ruleId");
    const rule = await this.seasonalPricingService.update(
      this.requireRouteId(request),
      ruleId,
      auth.sub,
      body,
    );
    ok(response, rule, {
      message: "Seasonal pricing rule updated successfully.",
    });
  };

  deleteSeasonalPricingRule = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const ruleId = requireSafeRouteParam(request, "ruleId");
    await this.seasonalPricingService.delete(
      this.requireRouteId(request),
      ruleId,
      auth.sub,
    );
    noContent(response);
  };

  private toUpsertInput(
    body: UpsertPostingRequestBody | UpdatePostingRequestBody,
  ): UpsertPostingInput {
    const availabilityBlocks =
      "availabilityBlocks" in body ? body.availabilityBlocks : [];

    return {
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
      expiresAt: body.expiresAt ?? null,
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
    request: Request,
  ): Omit<ListOwnerPostingsInput, "organizationId"> {
    const url = getRequestUrl(request);

    try {
      const query = listOwnerPostingsQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
      });

      return this.toListOwnerPostingsInput(query);
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parseSearchPostingsInput(request: Request): SearchPostingsInput {
    const url = getRequestUrl(request);

    try {
      const query = publicSearchPostingsQuerySchema.parse({
        page: this.readOptionalQueryParam(url.searchParams, "page"),
        pageSize: this.readOptionalQueryParam(url.searchParams, "pageSize"),
        q: this.readOptionalQueryParam(url.searchParams, "q"),
        organization: this.readOptionalQueryParam(
          url.searchParams,
          "organization",
        ),
        organizationId: this.readOptionalQueryParam(
          url.searchParams,
          "organizationId",
        ),
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
        cancellationPolicy: this.readOptionalQueryParam(
          url.searchParams,
          "cancellationPolicy",
        ),
        instantBooking: this.readOptionalQueryParam(
          url.searchParams,
          "instantBooking",
        ),
        maxMinBookingDurationDays: this.readOptionalQueryParam(
          url.searchParams,
          "maxMinBookingDurationDays",
        ),
      });
      const attributeFilters = this.readAttributeFilters(url.searchParams);

      return this.toSearchPostingsInput(query, attributeFilters);
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parseListPostingReviewsQuery(
    request: Request,
  ): ListPostingReviewsQuery {
    const url = getRequestUrl(request);

    try {
      return listPostingReviewsQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
      });
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parseListSavedPostingsQuery(
    request: Request,
  ): ListSavedPostingsQuery {
    const url = getRequestUrl(request);

    try {
      return listSavedPostingsQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
      });
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parseAnalyticsSummaryQuery(
    request: Request,
  ): PostingAnalyticsSummaryQuery {
    const url = getRequestUrl(request);

    try {
      return postingAnalyticsSummaryQuerySchema.parse({
        window: url.searchParams.get("window") ?? undefined,
      });
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parseAvailabilityCalendarQuery(
    request: Request,
  ): AvailabilityCalendarQuery {
    const url = getRequestUrl(request);

    try {
      return availabilityCalendarQuerySchema.parse({
        year: url.searchParams.get("year") ?? undefined,
        month: url.searchParams.get("month") ?? undefined,
        tz: url.searchParams.get("tz") ?? undefined,
      });
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parseListPostingAnalyticsInput(
    request: Request,
    actorUserId: Uuid,
  ): ListPostingAnalyticsInput {
    const url = getRequestUrl(request);

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
    request: Request,
    actorUserId: Uuid,
    postingId: Uuid,
  ): PostingAnalyticsDetailInput {
    const url = getRequestUrl(request);

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
      q: query.q,
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
      organizationQuery: query.organization,
      organizationId: asOptionalUuid(query.organizationId),
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
    actorUserId: Uuid,
    query: ListPostingAnalyticsQuery,
  ): ListPostingAnalyticsInput {
    return {
      actorUserId,
      window: query.window,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private toPostingAnalyticsDetailInput(
    actorUserId: Uuid,
    postingId: Uuid,
    query: PostingAnalyticsDetailQuery,
  ): PostingAnalyticsDetailInput {
    return {
      actorUserId,
      postingId,
      window: query.window,
      granularity: query.granularity,
    };
  }

  private parseBatchIds(request: Request): string[] {
    const url = getRequestUrl(request);
    try {
      return postingBatchIdsQuerySchema.parse(
        this.readArrayQuery(url.searchParams, "ids"),
      );
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parseAutocompletePostingsInput(
    request: Request,
  ): PostingAutocompleteInput {
    const url = getRequestUrl(request);

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

  private requireRouteId(request: Request): Uuid {
    return this.requireRouteParam(request, "id");
  }

  private requireRouteParam(request: Request, name: string): Uuid {
    const value = requireSafeRouteParam(request, name);

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

  private async requireAuth(request: Request): Promise<AuthPrincipal> {
    return requireJwtAuth(request);
  }

  private async getOptionalAuth(
    request: Request,
  ): Promise<AuthPrincipal | null> {
    return getOptionalJwtAuth(request);
  }

  private readRequestId(request: Request): string | undefined {
    return request.requestId;
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
