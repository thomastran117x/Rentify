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
  PostingAnalyticsWindow,
} from "@/features/postings/analytics/analytics.model";
import type { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import {
  isPostingPubliclyVisible,
  type PublicPostingRecord,
  type PostingRecord,
} from "@/features/postings/postings.model";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";

export class PostingsAnalyticsService {
  constructor(
    private readonly analyticsRepository: PostingsAnalyticsRepository,
    private readonly postingsRepository: PostingsRepository,
    private readonly organizationAccessService: OrganizationAccessService,
  ) {}

  async trackPublicView(
    posting: PostingRecord | PublicPostingRecord,
    client: ClientRequestContext,
    viewerUserId?: string,
  ): Promise<void> {
    if (!isPostingPubliclyVisible(posting)) {
      return;
    }

    const organizationId = await this.resolvePostingOrganizationId(posting);

    if (
      viewerUserId &&
      organizationId &&
      (await this.organizationAccessService.findMembership(
        viewerUserId,
        organizationId,
      ))
    ) {
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
      organizationId,
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
      postings.map(async (posting) => {
        const metadata =
          await this.postingsRepository.findPublicReadMetadataById(posting.id);

        if (!metadata) {
          return;
        }

        await this.analyticsRepository.enqueueSearchImpressionEvent({
          postingId: metadata.id,
          organizationId: metadata.organizationId,
          occurredAt,
        });
      }),
    );
  }

  async trackSearchClick(
    postingId: string,
    viewerUserId?: string,
  ): Promise<void> {
    const metadata =
      await this.postingsRepository.findPublicReadMetadataById(postingId);

    if (!metadata || !isPostingPubliclyVisible(metadata)) {
      return;
    }

    if (
      viewerUserId &&
      (await this.organizationAccessService.findMembership(
        viewerUserId,
        metadata.organizationId,
      ))
    ) {
      return;
    }

    await this.analyticsRepository.enqueueSearchClickEvent({
      postingId: metadata.id,
      organizationId: metadata.organizationId,
      occurredAt: new Date().toISOString(),
    });
  }

  async getOwnerSummary(
    actorUserId: string,
    window: "7d" | "30d" | "all",
  ): Promise<OwnerPostingsAnalyticsSummary> {
    const membership =
      await this.organizationAccessService.requireActiveMembership(
        actorUserId,
        "Select or join an organization before viewing posting analytics.",
      );

    return this.analyticsRepository.getOwnerSummary({
      actorUserId,
      organizationId: membership.organizationId,
      window,
    });
  }

  async listOwnerPostingsAnalytics(input: ListPostingAnalyticsInput) {
    const membership =
      await this.organizationAccessService.requireActiveMembership(
        input.actorUserId,
        "Select or join an organization before viewing posting analytics.",
      );
    return this.analyticsRepository.listOwnerPostingsAnalytics({
      ...input,
      organizationId: membership.organizationId,
    });
  }

  async getPostingAnalyticsDetail(
    input: PostingAnalyticsDetailInput,
  ): Promise<PostingAnalyticsDetail> {
    const posting = await this.postingsRepository.findById(input.postingId);

    if (!posting) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    await this.organizationAccessService.requireMembership(
      input.actorUserId,
      posting.organizationId,
      "You do not have access to this posting analytics.",
    );

    if (input.window !== "7d" && input.granularity === "hour") {
      throw new BadRequestError(
        "Hourly analytics are only supported for the 7d window.",
      );
    }

    const detail = await this.analyticsRepository.getPostingAnalyticsDetail({
      ...input,
      organizationId: posting.organizationId,
    });

    if (!detail) {
      throw new ResourceNotFoundError("Posting analytics could not be found.");
    }

    return detail;
  }

  async exportAsCsv(
    actorUserId: string,
    window: PostingAnalyticsWindow,
  ): Promise<string> {
    const membership =
      await this.organizationAccessService.requireActiveMembership(
        actorUserId,
        "Select or join an organization before exporting analytics.",
      );

    const rows = await this.analyticsRepository.listDailyAnalyticsForExport(
      membership.organizationId,
      window,
    );

    const headers = [
      "date",
      "postingId",
      "postingName",
      "searchImpressions",
      "searchClicks",
      "views",
      "uniqueViews",
      "bookingRequests",
      "approvedRequests",
      "declinedRequests",
      "expiredRequests",
      "cancelledRequests",
      "paymentFailedRequests",
      "confirmedBookings",
      "estimatedConfirmedRevenue",
      "refundedRevenue",
    ];

    const csvRows = rows.map((row) => [
      row.date.toISOString().slice(0, 10),
      row.postingId,
      `"${row.postingName.replace(/"/g, '""')}"`,
      Number(row.searchImpressions),
      Number(row.searchClicks),
      Number(row.views),
      Number(row.uniqueViews),
      Number(row.bookingRequests),
      Number(row.approvedRequests),
      Number(row.declinedRequests),
      Number(row.expiredRequests),
      Number(row.cancelledRequests),
      Number(row.paymentFailedRequests),
      Number(row.confirmedBookings),
      Number(row.estimatedConfirmedRevenue),
      Number(row.refundedRevenue),
    ]);

    return [headers.join(","), ...csvRows.map((r) => r.join(","))].join("\n");
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

  private async resolvePostingOrganizationId(
    posting: PostingRecord | PublicPostingRecord,
  ): Promise<string> {
    if ("organizationId" in posting) {
      return posting.organizationId;
    }

    const metadata = await this.postingsRepository.findPublicReadMetadataById(
      posting.id,
    );

    if (!metadata) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    return metadata.organizationId;
  }
}
