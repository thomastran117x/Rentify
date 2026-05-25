import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { ZodError } from "zod";
import { RequestValidationError } from "@/configuration/validation/request";
import type { BlobService } from "@/features/blob/blob.service";
import type { CacheService } from "@/features/cache/cache.service";
import { flowLockKeys, withFlowLock } from "@/features/cache/cache-locks";
import {
  MAX_BATCH_IDS,
  MAX_BOOKING_DURATION_DAYS_LIMIT,
  MAX_POSTING_PHOTOS,
  MAX_SEARCH_RESULT_WINDOW,
  type BatchPostingsResult,
  type ListOwnerPostingsInput,
  type ListOwnerPostingsResult,
  type ManagedPostingPhotoInput,
  type PublicPostingRecord,
  type PostingAvailabilityBlockRecord,
  type PostingAvailabilityBlockInput,
  type PostingAttributeValue,
  parsePostingDetailsForVariant,
  type PostingFamily,
  type PostingPricing,
  type PostingRecord,
  type SearchAttributeFilterInput,
  type PostingSubtype,
  type SearchPostingsInput,
  type SearchPostingsResult,
  toPostingAttributes,
  type UpsertPostingInput,
  isPostingPubliclyVisible,
} from "@/features/postings/postings.model";
import { invalidatePublicPostingProjection } from "@/features/postings/postings.public-cache-invalidation";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import {
  getPostingSearchableAttributeDefinitions,
  getPostingVariantDefinition,
  type SearchablePostingAttributeDefinition,
} from "@/features/postings/postings.variants";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { PostingsReviewsRepository } from "@/features/postings/reviews/reviews.repository";
import type { PostingThumbnailQueueService } from "@/features/postings/thumbnail/thumbnail.queue.service";
import type { PostingsPublicSearchService } from "@/features/postings/search/public-search.service";
import type { RentingsRepository } from "@/features/rentings/rentings.repository";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";
import { loggerFactory, type Logger } from "@/configuration/logging";

export class PostingsService {
  private readonly logger: Logger;

  constructor(
    private readonly postingsRepository: PostingsRepository,
    private readonly postingsPublicSearchService: PostingsPublicSearchService,
    private readonly postingsReviewsRepository: PostingsReviewsRepository,
    private readonly rentingsRepository: RentingsRepository,
    private readonly blobService: BlobService,
    private readonly postingThumbnailQueueService: PostingThumbnailQueueService,
    private readonly contentSanitizationService: ContentSanitizationService,
    private readonly cacheService: CacheService,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
  ) {
    this.logger = loggerFactory.forClass(PostingsService, "service");
  }

  async createDraft(input: UpsertPostingInput): Promise<PostingRecord> {
    const normalizedInput = this.normalizeUpsertInput(input);
    this.assertSafeTextContent(normalizedInput);
    this.assertPublishableDraftShape(normalizedInput);

    const created = await this.postingsRepository.create(normalizedInput);
    await this.invalidatePublicProjection(created.id);
    await this.enqueueThumbnailGeneration(created.id);
    return created;
  }

  async duplicate(id: string, ownerId: string): Promise<PostingRecord> {
    const posting = await this.requireOwnerPosting(id, ownerId);
    const availabilityBlocks =
      await this.postingsRepository.listOwnerAvailabilityBlocks(posting.id);
    const duplicateInput = this.normalizeUpsertInput(
      this.toDuplicateInput(posting, availabilityBlocks),
    );
    this.assertSafeTextContent(duplicateInput);
    this.assertPublishableDraftShape(duplicateInput);

    const duplicated = await this.postingsRepository.create(duplicateInput);
    await this.invalidatePublicProjection(duplicated.id);
    await this.enqueueThumbnailGeneration(duplicated.id);
    return duplicated;
  }

  async update(id: string, input: UpsertPostingInput): Promise<PostingRecord> {
    const existing = await this.requireOwnerPosting(id, input.ownerId);
    const normalizedInput = this.normalizeUpsertInput(input);
    this.assertSafeTextContent(normalizedInput);
    this.assertPublishableDraftShape(normalizedInput);

    const updated = await this.postingsRepository.update(
      existing.id,
      normalizedInput,
    );

    if (!updated) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    await this.invalidatePublicProjection(updated.id);
    await this.enqueueThumbnailGeneration(updated.id);
    return updated;
  }

  async listOwnerAvailabilityBlocks(
    id: string,
    ownerId: string,
  ): Promise<{ availabilityBlocks: PostingAvailabilityBlockRecord[] }> {
    const posting = await this.requireOwnerPostingForAvailability(id, ownerId);
    const availabilityBlocks =
      await this.postingsRepository.listOwnerAvailabilityBlocks(posting.id);

    return {
      availabilityBlocks,
    };
  }

  async createOwnerAvailabilityBlock(
    id: string,
    ownerId: string,
    input: PostingAvailabilityBlockInput,
  ): Promise<PostingAvailabilityBlockRecord> {
    const posting = await this.requireOwnerPostingForAvailability(id, ownerId);
    const normalized = this.normalizeSingleAvailabilityBlock(input);
    this.assertSafeAvailabilityBlockContent(normalized);

    return withFlowLock(
      this.cacheService,
      flowLockKeys.postingBookingWindow(posting.id),
      async () => {
        await this.assertAvailabilityBlockCanBeWritten(posting.id, normalized);
        const created =
          await this.postingsRepository.createOwnerAvailabilityBlock(
            posting.id,
            normalized,
          );
        await this.invalidatePublicProjection(posting.id);
        return created;
      },
      "Another request is already modifying this posting's availability. Please retry.",
    );
  }

  async updateOwnerAvailabilityBlock(
    id: string,
    ownerId: string,
    blockId: string,
    input: PostingAvailabilityBlockInput,
  ): Promise<PostingAvailabilityBlockRecord> {
    const posting = await this.requireOwnerPostingForAvailability(id, ownerId);
    const normalized = this.normalizeSingleAvailabilityBlock(input);
    this.assertSafeAvailabilityBlockContent(normalized);

    return withFlowLock(
      this.cacheService,
      flowLockKeys.postingBookingWindow(posting.id),
      async () => {
        await this.assertExistingOwnerAvailabilityBlock(posting.id, blockId);
        await this.assertAvailabilityBlockCanBeWritten(
          posting.id,
          normalized,
          blockId,
        );

        const updated =
          await this.postingsRepository.updateOwnerAvailabilityBlock(
            posting.id,
            blockId,
            normalized,
          );

        if (!updated) {
          throw new ConflictError(
            "This availability block changed before the update could be completed.",
          );
        }

        await this.invalidatePublicProjection(posting.id);
        return updated;
      },
      "Another request is already modifying this posting's availability. Please retry.",
    );
  }

  async deleteOwnerAvailabilityBlock(
    id: string,
    ownerId: string,
    blockId: string,
  ): Promise<void> {
    const posting = await this.requireOwnerPostingForAvailability(id, ownerId);

    await withFlowLock(
      this.cacheService,
      flowLockKeys.postingBookingWindow(posting.id),
      async () => {
        const deleted =
          await this.postingsRepository.deleteOwnerAvailabilityBlock(
            posting.id,
            blockId,
          );

        if (!deleted) {
          throw new ResourceNotFoundError(
            "Availability block could not be found.",
          );
        }

        await this.invalidatePublicProjection(posting.id);
      },
      "Another request is already modifying this posting's availability. Please retry.",
    );
  }

  async publish(id: string, ownerId: string): Promise<PostingRecord> {
    const posting = await this.requireOwnerPosting(id, ownerId);
    this.assertCanPublish(posting);

    const published = await this.postingsRepository.publish(id, ownerId);

    if (!published) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    await this.invalidatePublicProjection(published.id);
    await this.enqueueThumbnailGeneration(published.id);
    return published;
  }

  async pause(id: string, ownerId: string): Promise<PostingRecord> {
    const posting = await this.requireOwnerPosting(id, ownerId);
    this.assertCanPause(posting);

    return withFlowLock(
      this.cacheService,
      flowLockKeys.postingBookingWindow(posting.id),
      async () => {
        const lockedPosting = await this.requireOwnerPosting(id, ownerId);
        this.assertCanPause(lockedPosting);
        const paused = await this.postingsRepository.pause(id, ownerId);

        if (!paused) {
          throw new ResourceNotFoundError("Posting could not be found.");
        }

        await this.invalidatePublicProjection(paused.id);
        return paused;
      },
      "Another request is already modifying this posting's booking availability. Please retry.",
    );
  }

  async unpause(id: string, ownerId: string): Promise<PostingRecord> {
    const posting = await this.requireOwnerPosting(id, ownerId);
    this.assertCanUnpause(posting);

    return withFlowLock(
      this.cacheService,
      flowLockKeys.postingBookingWindow(posting.id),
      async () => {
        const lockedPosting = await this.requireOwnerPosting(id, ownerId);
        this.assertCanUnpause(lockedPosting);
        const unpaused = await this.postingsRepository.unpause(id, ownerId);

        if (!unpaused) {
          throw new ResourceNotFoundError("Posting could not be found.");
        }

        await this.invalidatePublicProjection(unpaused.id);
        await this.enqueueThumbnailGeneration(unpaused.id);
        return unpaused;
      },
      "Another request is already modifying this posting's booking availability. Please retry.",
    );
  }

  async archive(id: string, ownerId: string): Promise<PostingRecord> {
    const posting = await this.requireOwnerPosting(id, ownerId);
    this.assertCanArchive(posting);
    const archived = await this.postingsRepository.archive(id, ownerId);

    if (!archived) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    await this.invalidatePublicProjection(archived.id);
    return archived;
  }

  async getById(
    id: string,
    viewerId?: string,
  ): Promise<PostingRecord | PublicPostingRecord> {
    if (viewerId) {
      const metadata =
        await this.postingsRepository.findPublicReadMetadataById(id);

      if (!metadata) {
        throw new ResourceNotFoundError("Posting could not be found.");
      }

      if (metadata.ownerId === viewerId) {
        const ownerPosting = await this.postingsRepository.findById(id);

        if (!ownerPosting) {
          throw new ResourceNotFoundError("Posting could not be found.");
        }

        return ownerPosting;
      }

      if (!isPostingPubliclyVisible(metadata)) {
        throw new ResourceNotFoundError("Posting could not be found.");
      }
    }

    const publicPosting =
      await this.postingsPublicCacheService.getPublicById(id);

    if (!publicPosting) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    if (!viewerId) {
      return publicPosting;
    }

    const [hasEligibleReviewRenting, ownReview] = await Promise.all([
      this.rentingsRepository.hasEligibleReviewRenting({
        postingId: publicPosting.id,
        renterId: viewerId,
        now: new Date(),
      }),
      this.postingsReviewsRepository.findOwnReview(publicPosting.id, viewerId),
    ]);

    return {
      ...publicPosting,
      viewerReviewState: {
        eligible: hasEligibleReviewRenting,
        hasOwnReview: Boolean(ownReview),
      },
    };
  }

  async listByOwner(
    input: ListOwnerPostingsInput,
  ): Promise<ListOwnerPostingsResult> {
    return this.postingsRepository.listByOwner(input);
  }

  async batchByOwner(
    ownerId: string,
    ids: string[],
  ): Promise<BatchPostingsResult<PostingRecord>> {
    const normalizedIds = this.normalizeBatchIds(ids);

    return this.postingsRepository.batchFindByOwner({
      ownerId,
      ids: normalizedIds,
    });
  }

  async batchPublic(
    ids: string[],
  ): Promise<BatchPostingsResult<PublicPostingRecord>> {
    const normalizedIds = this.normalizeBatchIds(ids);
    return this.postingsPublicCacheService.getPublicByIds(normalizedIds);
  }

  async searchPublic(
    input: SearchPostingsInput,
  ): Promise<SearchPostingsResult> {
    this.assertValidSearchInput(input);
    return this.postingsPublicSearchService.searchPublic({
      ...input,
      query: input.query?.trim() || undefined,
      tags: input.tags?.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
      attributeFilters: this.normalizeSearchAttributeFilters(
        input.attributeFilters,
        input.family,
        input.subtype,
      ),
    });
  }

  private normalizeUpsertInput(input: UpsertPostingInput): UpsertPostingInput {
    const normalizedPhotos = this.normalizePhotos(input.photos);
    const normalizedBlocks = this.normalizeAvailabilityBlocks(
      input.availabilityBlocks,
    );
    const normalizedTags = Array.from(
      new Set(
        input.tags
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0),
      ),
    );
    const normalizedPricing = this.normalizePricing(input.pricing);
    this.assertValidVariantSelection(
      input.variant.family,
      input.variant.subtype,
    );

    return {
      ...input,
      variant: {
        family: input.variant.family,
        subtype: input.variant.subtype,
      },
      name: input.name.trim(),
      description: input.description.trim(),
      pricing: normalizedPricing,
      photos: normalizedPhotos,
      tags: normalizedTags,
      details: this.normalizePostingDetails(input),
      availabilityStatus: input.availabilityStatus,
      availabilityNotes: input.availabilityNotes?.trim() || null,
      maxBookingDurationDays: input.maxBookingDurationDays ?? null,
      availabilityBlocks: normalizedBlocks,
      location: {
        ...input.location,
        city: input.location.city.trim(),
        region: input.location.region.trim(),
        country: input.location.country.trim(),
        postalCode: input.location.postalCode?.trim() || undefined,
      },
    };
  }

  private normalizePhotos(
    photos: ManagedPostingPhotoInput[],
  ): ManagedPostingPhotoInput[] {
    if (photos.length === 0) {
      throw new BadRequestError("At least one photo is required.");
    }

    if (photos.length > MAX_POSTING_PHOTOS) {
      throw new BadRequestError(
        `A posting can include at most ${MAX_POSTING_PHOTOS} photos.`,
      );
    }

    const uniquePositions = new Set<number>();

    for (const photo of photos) {
      if (uniquePositions.has(photo.position)) {
        throw new BadRequestError("Photo positions must be unique.");
      }

      uniquePositions.add(photo.position);
      this.assertManagedBlob(photo.blobUrl, photo.blobName);

      const hasThumbnailBlobName = typeof photo.thumbnailBlobName === "string";
      const hasThumbnailBlobUrl = typeof photo.thumbnailBlobUrl === "string";

      if (hasThumbnailBlobName !== hasThumbnailBlobUrl) {
        throw new BadRequestError(
          "Thumbnail blob URL and thumbnail blob name must be provided together.",
        );
      }
    }

    return photos
      .slice()
      .sort((left, right) => left.position - right.position)
      .map((photo, index) => ({
        ...photo,
        position: index,
      }));
  }

  private normalizeAvailabilityBlocks(
    blocks: PostingAvailabilityBlockInput[],
  ): PostingAvailabilityBlockInput[] {
    const normalized = blocks
      .map((block) => ({
        ...block,
        note: block.note?.trim() || undefined,
      }))
      .sort(
        (left, right) =>
          new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
      );

    for (const block of normalized) {
      const startAt = new Date(block.startAt);
      const endAt = new Date(block.endAt);

      if (
        Number.isNaN(startAt.getTime()) ||
        Number.isNaN(endAt.getTime()) ||
        startAt >= endAt
      ) {
        throw new BadRequestError(
          "Availability block dates must define a valid, non-empty range.",
        );
      }
    }

    for (let index = 1; index < normalized.length; index += 1) {
      const previous = normalized[index - 1];
      const current = normalized[index];

      if (new Date(current.startAt) < new Date(previous.endAt)) {
        throw new BadRequestError("Availability blocks may not overlap.");
      }
    }

    return normalized;
  }

  private normalizeSingleAvailabilityBlock(
    block: PostingAvailabilityBlockInput,
  ): PostingAvailabilityBlockInput {
    return this.normalizeAvailabilityBlocks([block])[0]!;
  }

  private normalizePricing(pricing: PostingPricing): PostingPricing {
    return {
      currency: pricing.currency.trim().toUpperCase(),
      daily: {
        amount: pricing.daily.amount,
      },
      ...(pricing.hourly ? { hourly: { amount: pricing.hourly.amount } } : {}),
      ...(pricing.weekly ? { weekly: { amount: pricing.weekly.amount } } : {}),
      ...(pricing.monthly
        ? { monthly: { amount: pricing.monthly.amount } }
        : {}),
    };
  }

  private assertSafeTextContent(input: UpsertPostingInput): void {
    const violations = this.contentSanitizationService
      .inspect(this.collectTextInputs(input))
      .map((violation) => ({
        path: violation.path,
        message: violation.message,
      }));

    if (violations.length > 0) {
      throw new BadRequestError("Request body validation failed.", violations);
    }
  }

  private normalizePostingDetails(input: UpsertPostingInput) {
    try {
      return parsePostingDetailsForVariant(input.variant, input.details);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestError(
          "Request body validation failed.",
          error.issues.map((issue) => ({
            path:
              issue.path.length > 0
                ? `details.${issue.path.join(".")}`
                : "details",
            message: issue.message,
          })),
        );
      }

      throw error;
    }
  }

  private toDuplicateInput(
    posting: PostingRecord,
    availabilityBlocks: PostingAvailabilityBlockRecord[],
  ): UpsertPostingInput {
    // Duplicate the posting with the same managed photo blobs and only owner-authored
    // availability blocks; transient booking holds should not carry over to the new draft.
    return {
      ownerId: posting.ownerId,
      variant: posting.variant,
      name: posting.name,
      description: posting.description,
      pricing: posting.pricing,
      photos: posting.photos.map((photo) => ({
        blobUrl: photo.blobUrl,
        blobName: photo.blobName,
        thumbnailBlobUrl: photo.thumbnailBlobUrl,
        thumbnailBlobName: photo.thumbnailBlobName,
        position: photo.position,
      })),
      tags: [...posting.tags],
      details: posting.details,
      availabilityStatus: posting.availabilityStatus,
      availabilityNotes: posting.availabilityNotes ?? null,
      maxBookingDurationDays: posting.maxBookingDurationDays ?? null,
      availabilityBlocks: availabilityBlocks.map((block) => ({
        startAt: block.startAt,
        endAt: block.endAt,
        note: block.note,
      })),
      location: {
        ...posting.location,
      },
    };
  }

  private assertSafeAvailabilityBlockContent(
    input: PostingAvailabilityBlockInput,
  ): void {
    if (!input.note) {
      return;
    }

    const violations = this.contentSanitizationService
      .inspect([
        {
          path: "note",
          value: input.note,
        },
      ])
      .map((violation) => ({
        path: violation.path,
        message: violation.message,
      }));

    if (violations.length > 0) {
      throw new BadRequestError("Request body validation failed.", violations);
    }
  }

  private async assertExistingOwnerAvailabilityBlock(
    postingId: string,
    blockId: string,
  ): Promise<void> {
    const block = await this.postingsRepository.findOwnerAvailabilityBlock(
      postingId,
      blockId,
    );

    if (!block) {
      throw new ResourceNotFoundError("Availability block could not be found.");
    }
  }

  private async assertAvailabilityBlockCanBeWritten(
    postingId: string,
    block: PostingAvailabilityBlockInput,
    excludeBlockId?: string,
  ): Promise<void> {
    const startAt = new Date(block.startAt);
    const endAt = new Date(block.endAt);

    const ownerOverlap =
      await this.postingsRepository.hasOwnerAvailabilityBlockOverlap({
        postingId,
        startAt,
        endAt,
        excludeBlockId,
      });

    if (ownerOverlap) {
      throw new BadRequestError("Availability blocks may not overlap.");
    }

    const bookingConflict =
      await this.postingsRepository.hasActiveBookingAvailabilityConflict({
        postingId,
        startAt,
        endAt,
      });

    if (bookingConflict) {
      throw new ConflictError(
        "Availability block conflicts with an active booking request or hold.",
      );
    }

    const rentingConflict =
      await this.postingsRepository.hasRentingAvailabilityConflict({
        postingId,
        startAt,
        endAt,
      });

    if (rentingConflict) {
      throw new ConflictError(
        "Availability block conflicts with a confirmed renting.",
      );
    }
  }

  private collectTextInputs(
    input: UpsertPostingInput,
  ): Array<{ path: string; value: string }> {
    const textInputs: Array<{ path: string; value: string }> = [
      {
        path: "name",
        value: input.name,
      },
      {
        path: "description",
        value: input.description,
      },
      {
        path: "location.city",
        value: input.location.city,
      },
      {
        path: "location.region",
        value: input.location.region,
      },
      {
        path: "location.country",
        value: input.location.country,
      },
    ];

    if (input.availabilityNotes) {
      textInputs.push({
        path: "availabilityNotes",
        value: input.availabilityNotes,
      });
    }

    if (input.location.postalCode) {
      textInputs.push({
        path: "location.postalCode",
        value: input.location.postalCode,
      });
    }

    input.tags.forEach((tag, index) => {
      textInputs.push({
        path: `tags.${index}`,
        value: tag,
      });
    });

    input.availabilityBlocks.forEach((block, index) => {
      if (block.note) {
        textInputs.push({
          path: `availabilityBlocks.${index}.note`,
          value: block.note,
        });
      }
    });

    Object.entries(toPostingAttributes(input.details)).forEach(
      ([key, value]) => {
        if (typeof value === "string") {
          textInputs.push({
            path: `details.${key}`,
            value,
          });
          return;
        }

        if (Array.isArray(value)) {
          value.forEach((entry, index) => {
            textInputs.push({
              path: `details.${key}.${index}`,
              value: entry,
            });
          });
        }
      },
    );

    return textInputs;
  }

  private assertCanPublish(posting: PostingRecord): void {
    if (posting.status !== "draft") {
      throw new BadRequestError("Only draft postings can be published.");
    }

    if (
      posting.photos.length < 1 ||
      posting.photos.length > MAX_POSTING_PHOTOS
    ) {
      throw new BadRequestError(
        "Published postings must include between 1 and 10 photos.",
      );
    }

    if (!posting.pricing.daily?.amount || posting.pricing.daily.amount <= 0) {
      throw new BadRequestError(
        "Published postings must include a valid daily price.",
      );
    }

    if (!this.isValidCoordinate(posting.location.latitude, -90, 90)) {
      throw new BadRequestError(
        "Published postings must include a valid latitude.",
      );
    }

    if (!this.isValidCoordinate(posting.location.longitude, -180, 180)) {
      throw new BadRequestError(
        "Published postings must include a valid longitude.",
      );
    }
  }

  private assertCanPause(posting: PostingRecord): void {
    if (posting.status !== "published") {
      throw new BadRequestError("Only published postings can be paused.");
    }
  }

  private assertCanUnpause(posting: PostingRecord): void {
    if (posting.status !== "paused") {
      throw new BadRequestError("Only paused postings can be unpaused.");
    }
  }

  private assertCanArchive(posting: PostingRecord): void {
    if (posting.status === "archived") {
      throw new BadRequestError("Archived postings cannot be archived again.");
    }
  }

  private assertPublishableDraftShape(input: UpsertPostingInput): void {
    if (!input.name.trim()) {
      throw new BadRequestError("Posting name is required.");
    }

    if (!input.description.trim()) {
      throw new BadRequestError("Posting description is required.");
    }

    if (!input.pricing.daily || input.pricing.daily.amount <= 0) {
      throw new BadRequestError("Posting daily pricing is required.");
    }

    if (!this.isValidCoordinate(input.location.latitude, -90, 90)) {
      throw new BadRequestError("Latitude must be between -90 and 90.");
    }

    if (!this.isValidCoordinate(input.location.longitude, -180, 180)) {
      throw new BadRequestError("Longitude must be between -180 and 180.");
    }

    if (
      input.maxBookingDurationDays !== undefined &&
      input.maxBookingDurationDays !== null &&
      (!Number.isInteger(input.maxBookingDurationDays) ||
        input.maxBookingDurationDays < 1 ||
        input.maxBookingDurationDays > MAX_BOOKING_DURATION_DAYS_LIMIT)
    ) {
      throw new BadRequestError(
        `Maximum booking duration must be an integer between 1 and ${MAX_BOOKING_DURATION_DAYS_LIMIT} days.`,
      );
    }
  }

  private assertManagedBlob(blobUrl: string, blobName: string): void {
    if (!this.blobService.isConfigured()) {
      throw new BadRequestError(
        "Posting photos require Azure Blob Storage to be configured on the backend.",
      );
    }

    if (!this.blobService.isManagedBlobUrl(blobUrl, blobName)) {
      throw new BadRequestError(
        "Posting photo URLs must match the configured Azure Blob Storage location.",
      );
    }
  }

  private assertValidSearchInput(input: SearchPostingsInput): void {
    if (input.family && input.subtype) {
      this.assertValidVariantSelection(input.family, input.subtype);
    }

    if (
      input.attributeFilters &&
      input.attributeFilters.length > 0 &&
      (!input.family || !input.subtype)
    ) {
      throw new RequestValidationError("Request query validation failed.", [
        {
          path: "attr",
          message: "Attribute filters require both family and subtype.",
        },
      ]);
    }

    if (
      input.minDailyPrice !== undefined &&
      input.maxDailyPrice !== undefined &&
      input.minDailyPrice > input.maxDailyPrice
    ) {
      throw new BadRequestError(
        "Minimum daily price cannot exceed maximum daily price.",
      );
    }

    if (input.sort === "nearest" && !input.geo) {
      throw new BadRequestError(
        "Nearest sorting requires latitude and longitude.",
      );
    }

    const resultWindowEnd = (input.page - 1) * input.pageSize + input.pageSize;

    if (resultWindowEnd > MAX_SEARCH_RESULT_WINDOW) {
      throw new RequestValidationError("Request query validation failed.", [
        {
          path: "page",
          message: `Requested page exceeds the maximum search window of ${MAX_SEARCH_RESULT_WINDOW} results.`,
        },
      ]);
    }

    if (input.availabilityWindow) {
      const startAt = new Date(input.availabilityWindow.startAt);
      const endAt = new Date(input.availabilityWindow.endAt);

      if (
        Number.isNaN(startAt.getTime()) ||
        Number.isNaN(endAt.getTime()) ||
        startAt >= endAt
      ) {
        throw new BadRequestError(
          "Availability window must define a valid, non-empty range.",
        );
      }
    }
  }

  private normalizeSearchAttributeFilters(
    filters: SearchAttributeFilterInput[] | undefined,
    family?: PostingFamily,
    subtype?: PostingSubtype,
  ): SearchAttributeFilterInput[] | undefined {
    if (!filters || filters.length === 0) {
      return undefined;
    }

    if (!family || !subtype) {
      return undefined;
    }

    const definitions = getPostingSearchableAttributeDefinitions(
      family,
      subtype,
    );

    if (!definitions) {
      throw new RequestValidationError("Request query validation failed.", [
        {
          path: "attr",
          message: "Attribute filters require a valid family and subtype.",
        },
      ]);
    }

    return filters.map((filter) => {
      const definition = definitions[filter.key];

      if (!definition) {
        throw new RequestValidationError("Request query validation failed.", [
          {
            path: `attr.${filter.key}`,
            message:
              "Attribute is not valid for the selected family and subtype.",
          },
        ]);
      }

      return this.normalizeSearchAttributeFilter(filter, definition);
    });
  }

  private normalizeSearchAttributeFilter(
    filter: SearchAttributeFilterInput,
    definition: SearchablePostingAttributeDefinition,
  ): SearchAttributeFilterInput {
    const path = `attr.${filter.key}`;
    const hasExactValue = filter.value !== undefined;
    const hasRange = filter.min !== undefined || filter.max !== undefined;

    if (hasExactValue && hasRange) {
      throw new RequestValidationError("Request query validation failed.", [
        {
          path,
          message:
            "Exact attribute filters cannot be combined with min/max range filters.",
        },
      ]);
    }

    if (
      filter.min !== undefined &&
      filter.max !== undefined &&
      Number.isFinite(filter.min) &&
      Number.isFinite(filter.max) &&
      filter.min > filter.max
    ) {
      throw new RequestValidationError("Request query validation failed.", [
        {
          path,
          message: "Attribute minimum cannot exceed attribute maximum.",
        },
      ]);
    }

    switch (definition.kind) {
      case "string": {
        if (hasRange || Array.isArray(filter.value)) {
          throw new RequestValidationError("Request query validation failed.", [
            {
              path,
              message: "String attributes support a single exact value only.",
            },
          ]);
        }

        if (typeof filter.value !== "string") {
          throw new RequestValidationError("Request query validation failed.", [
            {
              path,
              message: "String attributes require a string value.",
            },
          ]);
        }

        return {
          key: filter.key,
          value: filter.value.trim().toLowerCase(),
        };
      }
      case "stringArray": {
        if (hasRange || filter.value === undefined) {
          throw new RequestValidationError("Request query validation failed.", [
            {
              path,
              message: "Array attributes require one or more exact values.",
            },
          ]);
        }

        const values = Array.isArray(filter.value)
          ? filter.value
          : [filter.value];

        if (!values.every((value) => typeof value === "string")) {
          throw new RequestValidationError("Request query validation failed.", [
            {
              path,
              message: "Array attributes require string values.",
            },
          ]);
        }

        return {
          key: filter.key,
          value: Array.from(
            new Set(
              values.map((value) => value.trim().toLowerCase()).filter(Boolean),
            ),
          ),
        };
      }
      case "boolean": {
        if (hasRange) {
          throw new RequestValidationError("Request query validation failed.", [
            {
              path,
              message:
                "Boolean attributes support an exact true/false value only.",
            },
          ]);
        }

        return {
          key: filter.key,
          value: this.parseBooleanSearchAttributeValue(filter.value, path),
        };
      }
      case "integer":
      case "number": {
        if (Array.isArray(filter.value)) {
          throw new RequestValidationError("Request query validation failed.", [
            {
              path,
              message:
                "Numeric attributes support a single exact value or a min/max range.",
            },
          ]);
        }

        const exactValue =
          filter.value !== undefined
            ? this.parseNumericSearchAttributeValue(
                filter.value,
                path,
                definition.kind === "integer",
              )
            : undefined;
        const min =
          filter.min !== undefined
            ? this.parseNumericSearchAttributeValue(
                filter.min,
                `${path}.min`,
                definition.kind === "integer",
              )
            : undefined;
        const max =
          filter.max !== undefined
            ? this.parseNumericSearchAttributeValue(
                filter.max,
                `${path}.max`,
                definition.kind === "integer",
              )
            : undefined;

        if (
          exactValue === undefined &&
          min === undefined &&
          max === undefined
        ) {
          throw new RequestValidationError("Request query validation failed.", [
            {
              path,
              message:
                "Numeric attributes require an exact value or a min/max range.",
            },
          ]);
        }

        return {
          key: filter.key,
          ...(exactValue !== undefined ? { value: exactValue } : {}),
          ...(min !== undefined ? { min } : {}),
          ...(max !== undefined ? { max } : {}),
        };
      }
      default:
        return filter;
    }
  }

  private parseBooleanSearchAttributeValue(
    value: SearchAttributeFilterInput["value"],
    path: string,
  ): boolean {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();

      if (["1", "true", "yes", "on"].includes(normalized)) {
        return true;
      }

      if (["0", "false", "no", "off"].includes(normalized)) {
        return false;
      }
    }

    throw new RequestValidationError("Request query validation failed.", [
      {
        path,
        message: "Boolean attributes must be true or false.",
      },
    ]);
  }

  private parseNumericSearchAttributeValue(
    value: string | number | boolean,
    path: string,
    integerOnly: boolean,
  ): number {
    if (typeof value === "boolean") {
      throw new RequestValidationError("Request query validation failed.", [
        {
          path,
          message: "Numeric attributes must be valid numbers.",
        },
      ]);
    }

    const parsed = typeof value === "number" ? value : Number(value.trim());

    if (
      !Number.isFinite(parsed) ||
      (integerOnly && !Number.isInteger(parsed))
    ) {
      throw new RequestValidationError("Request query validation failed.", [
        {
          path,
          message: integerOnly
            ? "Integer attributes must be whole numbers."
            : "Numeric attributes must be valid numbers.",
        },
      ]);
    }

    return parsed;
  }

  private async requireOwnerPosting(
    id: string,
    ownerId: string,
  ): Promise<PostingRecord> {
    const posting = await this.postingsRepository.findById(id);

    if (!posting) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    if (posting.ownerId !== ownerId) {
      throw new ForbiddenError("You do not have access to this posting.");
    }

    return posting;
  }

  private async invalidatePublicProjection(postingId?: string): Promise<void> {
    await invalidatePublicPostingProjection(
      this.postingsPublicCacheService,
      postingId,
    );
  }

  private async requireOwnerPostingForAvailability(
    id: string,
    ownerId: string,
  ): Promise<PostingRecord> {
    const posting = await this.postingsRepository.findById(id);

    if (!posting || posting.ownerId !== ownerId) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    return posting;
  }

  private normalizeBatchIds(ids: string[]): string[] {
    const normalized = Array.from(
      new Set(ids.map((id) => id.trim()).filter(Boolean)),
    );

    if (normalized.length === 0) {
      throw new BadRequestError("At least one posting id is required.");
    }

    if (normalized.length > MAX_BATCH_IDS) {
      throw new BadRequestError(
        `At most ${MAX_BATCH_IDS} posting ids may be requested at once.`,
      );
    }

    return normalized;
  }

  private async enqueueThumbnailGeneration(postingId: string): Promise<void> {
    try {
      await this.postingThumbnailQueueService.enqueuePostingThumbnailJob(
        postingId,
      );
    } catch (error) {
      this.logger.error(
        "Failed to enqueue posting thumbnail job.",
        {
          postingId,
        },
        error,
      );
    }
  }

  private isValidCoordinate(value: number, min: number, max: number): boolean {
    return Number.isFinite(value) && value >= min && value <= max;
  }

  private assertValidVariantSelection(
    family: PostingFamily,
    subtype: PostingSubtype,
  ): void {
    if (!getPostingVariantDefinition(family, subtype)) {
      throw new BadRequestError(
        "Posting subtype does not belong to the selected family.",
        [
          {
            path: "variant.subtype",
            message: "Posting subtype does not belong to the selected family.",
          },
        ],
      );
    }
  }

  private normalizeSearchableAttributeValue(
    key: string,
    value: PostingAttributeValue,
    definition: {
      kind: "string" | "number" | "integer" | "boolean" | "stringArray";
      min?: number;
      max?: number;
    },
  ): PostingAttributeValue {
    const path = `details.${key}`;

    switch (definition.kind) {
      case "string": {
        if (typeof value !== "string") {
          throw new BadRequestError("Request body validation failed.", [
            {
              path,
              message: "Detail must be a string.",
            },
          ]);
        }

        return value.trim();
      }
      case "stringArray": {
        if (!Array.isArray(value)) {
          throw new BadRequestError("Request body validation failed.", [
            {
              path,
              message: "Detail must be an array of strings.",
            },
          ]);
        }

        return Array.from(
          new Set(value.map((entry) => entry.trim()).filter(Boolean)),
        );
      }
      case "boolean": {
        if (typeof value !== "boolean") {
          throw new BadRequestError("Request body validation failed.", [
            {
              path,
              message: "Detail must be a boolean.",
            },
          ]);
        }

        return value;
      }
      case "integer":
      case "number": {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new BadRequestError("Request body validation failed.", [
            {
              path,
              message:
                definition.kind === "integer"
                  ? "Detail must be an integer."
                  : "Detail must be a number.",
            },
          ]);
        }

        if (definition.kind === "integer" && !Number.isInteger(value)) {
          throw new BadRequestError("Request body validation failed.", [
            {
              path,
              message: "Detail must be an integer.",
            },
          ]);
        }

        if (definition.min !== undefined && value < definition.min) {
          throw new BadRequestError("Request body validation failed.", [
            {
              path,
              message: `Detail must be at least ${definition.min}.`,
            },
          ]);
        }

        if (definition.max !== undefined && value > definition.max) {
          throw new BadRequestError("Request body validation failed.", [
            {
              path,
              message: `Detail must be at most ${definition.max}.`,
            },
          ]);
        }

        return value;
      }
      default:
        return value;
    }
  }
}
