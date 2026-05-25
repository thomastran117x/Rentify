import { createHash } from "node:crypto";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type {
  ListPostingAnalyticsInput,
  OwnerPostingsAnalyticsSummary,
  PostingAnalyticsDetail,
  PostingAnalyticsDetailInput,
} from "@/features/postings/analytics/analytics.model";
import type { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import {
  isPostingPubliclyVisible,
  type PublicPostingRecord,
  type PostingRecord,
} from "@/features/postings/postings.model";
import type { PostingsRepository } from "@/features/postings/postings.repository";

export class PostingsAnalyticsService {
  constructor(
    private readonly analyticsRepository: PostingsAnalyticsRepository,
    private readonly postingsRepository: PostingsRepository,
  ) {}

  async trackPublicView(
    posting: PostingRecord | PublicPostingRecord,
    client: ClientRequestContext,
    viewerUserId?: string,
  ): Promise<void> {
    if (!isPostingPubliclyVisible(posting)) {
      return;
    }

    if (viewerUserId && viewerUserId === posting.ownerId) {
      return;
    }

    if (client.device.type === "bot") {
      return;
    }

    const occurredAt = new Date();
    const viewerHash = this.createViewerHash(
      posting.id,
      occurredAt,
      client,
      viewerUserId,
    );

    await this.analyticsRepository.enqueuePostingViewedEvent({
      postingId: posting.id,
      ownerId: posting.ownerId,
      occurredAt: occurredAt.toISOString(),
      viewerHash,
      userId: viewerUserId,
      ipAddressHash: client.ip ? this.hashValue(`ip:${client.ip}`) : undefined,
      userAgentHash: client.device.userAgent
        ? this.hashValue(`ua:${client.device.userAgent}`)
        : undefined,
      deviceType: client.device.type,
    });
  }

  async trackSearchImpressions(postings: PublicPostingRecord[]): Promise<void> {
    if (postings.length === 0) {
      return;
    }

    const occurredAt = new Date().toISOString();

    await Promise.all(
      postings.map((posting) =>
        this.analyticsRepository.enqueueSearchImpressionEvent({
          postingId: posting.id,
          ownerId: posting.ownerId,
          occurredAt,
        }),
      ),
    );
  }

  async trackSearchClick(postingId: string): Promise<void> {
    const metadata =
      await this.postingsRepository.findPublicReadMetadataById(postingId);

    if (!metadata || !isPostingPubliclyVisible(metadata)) {
      return;
    }

    await this.analyticsRepository.enqueueSearchClickEvent({
      postingId: metadata.id,
      ownerId: metadata.ownerId,
      occurredAt: new Date().toISOString(),
    });
  }

  async getOwnerSummary(
    ownerId: string,
    window: "7d" | "30d" | "all",
  ): Promise<OwnerPostingsAnalyticsSummary> {
    return this.analyticsRepository.getOwnerSummary({
      ownerId,
      window,
    });
  }

  async listOwnerPostingsAnalytics(input: ListPostingAnalyticsInput) {
    return this.analyticsRepository.listOwnerPostingsAnalytics(input);
  }

  async getPostingAnalyticsDetail(
    input: PostingAnalyticsDetailInput,
  ): Promise<PostingAnalyticsDetail> {
    const posting = await this.postingsRepository.findById(input.postingId);

    if (!posting) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    if (posting.ownerId !== input.ownerId) {
      throw new ForbiddenError(
        "You do not have access to this posting analytics.",
      );
    }

    if (input.window !== "7d" && input.granularity === "hour") {
      throw new BadRequestError(
        "Hourly analytics are only supported for the 7d window.",
      );
    }

    const detail =
      await this.analyticsRepository.getPostingAnalyticsDetail(input);

    if (!detail) {
      throw new ResourceNotFoundError("Posting analytics could not be found.");
    }

    return detail;
  }

  private createViewerHash(
    postingId: string,
    occurredAt: Date,
    client: ClientRequestContext,
    viewerUserId?: string,
  ): string {
    const dayBucket = occurredAt.toISOString().slice(0, 10);

    if (viewerUserId) {
      return this.hashValue(
        `posting:${postingId}:day:${dayBucket}:user:${viewerUserId}`,
      );
    }

    const fingerprintComponents = [
      `posting:${postingId}`,
      `day:${dayBucket}`,
      `ip:${client.ip ?? "unknown"}`,
      `ua:${client.device.userAgent ?? "unknown"}`,
      `device:${client.device.id ?? "unknown"}`,
    ];

    return this.hashValue(fingerprintComponents.join("|"));
  }

  private hashValue(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
