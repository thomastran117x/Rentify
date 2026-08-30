import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import BadRequestError from "@/errors/http/bad-request.error";
import type { ContentSanitizationService } from "@/features/security/content-sanitization.service";
import type {
  AssignContentReportInput,
  ContentReportRecord,
  ContentReportSubjectSnapshot,
  ContentReportUserSummary,
  CreateContentReportInput,
  ListContentReportsInput,
  ListContentReportsResult,
  ReportStatus,
  UpdateContentReportStatusInput,
} from "@/features/reports/reports.model";
import type { ReportsRepository } from "@/features/reports/reports.repository";
import type { ReportsSearchIndexService } from "@/features/reports/search/index.service";
import { loggerFactory, type Logger } from "@/configuration/logging";
import { normalizeAppRole, type AppRole } from "@/features/auth/auth.model";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { asOptionalUuid, asUuid, type Uuid } from "@/configuration/validation/uuid";

const MAX_SEARCH_OUTBOX_ATTEMPTS = 5;

export class ReportsService {
  private readonly logger: Logger;

  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly reportsSearchIndexService: ReportsSearchIndexService,
    private readonly contentSanitizationService: ContentSanitizationService,
    private readonly organizationAccessService: OrganizationAccessService,
  ) {
    this.logger = loggerFactory.forClass(ReportsService, "service");
  }

  async create(input: CreateContentReportInput): Promise<ContentReportRecord> {
    this.assertSafeTextContent(input.title, input.description);
    const subjectSnapshot = await this.resolveSubjectSnapshot(input);
    return this.reportsRepository.createReport(input, subjectSnapshot);
  }

  async listModeration(
    input: ListContentReportsInput,
  ): Promise<ListContentReportsResult> {
    if (!this.reportsSearchIndexService.isElasticsearchEnabled()) {
      const fallback = await this.reportsRepository.listReportsDb(input);
      return {
        ...fallback,
        source: "database",
      };
    }

    try {
      const searchResult = await this.reportsSearchIndexService.search(input);
      const reports = await this.reportsRepository.findReportsByIds(
        searchResult.ids,
      );

      return {
        reports,
        pagination: this.createPagination(
          input.page,
          input.pageSize,
          searchResult.total,
        ),
        source: "elasticsearch",
        ...(input.query ? { query: input.query } : {}),
      };
    } catch (error) {
      this.logger.warn(
        "Report moderation search fell back to the database.",
        undefined,
        error,
      );
      const fallback = await this.reportsRepository.listReportsDb(input);
      return {
        ...fallback,
        source: "database",
      };
    }
  }

  async getModerationDetail(id: string) {
    const report = await this.reportsRepository.findById(id);

    if (!report) {
      throw new ResourceNotFoundError("Report could not be found.");
    }

    return report;
  }

  async assign(input: AssignContentReportInput): Promise<ContentReportRecord> {
    const assigneeId = this.resolveAssigneeId(input);
    await this.assertAssignableModerator(assigneeId);

    const updated = await this.reportsRepository.updateAssignment({
      reportId: input.reportId,
      actorUserId: input.actorUserId,
      assignedModeratorId: assigneeId,
    });

    if (!updated) {
      throw new ResourceNotFoundError("Report could not be found.");
    }

    return updated;
  }

  async updateStatus(
    input: UpdateContentReportStatusInput,
  ): Promise<ContentReportRecord> {
    this.assertSafeOptionalText(input.resolutionSummary, input.note);

    const existing = await this.reportsRepository.findReportRecordById(
      input.reportId,
    );

    if (!existing) {
      throw new ResourceNotFoundError("Report could not be found.");
    }

    this.assertValidStatusTransition(existing.status, input.status);

    const updated = await this.reportsRepository.updateStatus({
      reportId: input.reportId,
      actorUserId: input.actorUserId,
      status: input.status,
      resolutionCode: input.resolutionCode,
      resolutionSummary: input.resolutionSummary?.trim() || undefined,
      note: input.note?.trim() || undefined,
    });

    if (!updated) {
      throw new ResourceNotFoundError("Report could not be found.");
    }

    return updated;
  }

  async processSearchOutboxBatch(limit: number): Promise<number> {
    const entries = await this.reportsRepository.claimSearchOutboxBatch(limit);

    if (entries.length === 0) {
      return 0;
    }

    const reports = await this.reportsRepository.listReportsForIndexing(
      entries.map((entry) => entry.reportId),
    );
    const reportsById = new Map(reports.map((report) => [report.id, report]));
    const processedIds: string[] = [];

    for (const entry of entries) {
      try {
        if (entry.operation === "delete") {
          await this.reportsSearchIndexService.deleteDocument(entry.reportId);
        } else {
          const report = reportsById.get(entry.reportId);

          if (!report) {
            await this.reportsSearchIndexService.deleteDocument(entry.reportId);
          } else {
            await this.reportsSearchIndexService.upsertDocument(report);
          }
        }

        processedIds.push(entry.id);
      } catch (error) {
        const nextAttempts = entry.attempts + 1;
        const message =
          error instanceof Error ? error.message : "Unknown indexing error.";

        if (nextAttempts >= MAX_SEARCH_OUTBOX_ATTEMPTS) {
          await this.reportsRepository.markSearchOutboxDeadLettered(
            entry.id,
            nextAttempts,
            message,
          );
        } else {
          await this.reportsRepository.retrySearchOutbox(
            entry.id,
            nextAttempts,
            message,
          );
        }
      }
    }

    await this.reportsRepository.markSearchOutboxProcessed(processedIds);
    return entries.length;
  }

  private async resolveSubjectSnapshot(
    input: CreateContentReportInput,
  ): Promise<ContentReportSubjectSnapshot> {
    switch (input.subjectType) {
      case "posting": {
        const posting = await this.reportsRepository.findPostingSubject(
          asUuid(input.subjectId),
        );

        if (!posting) {
          throw new ResourceNotFoundError("Posting could not be found.");
        }

        const membership = await this.organizationAccessService.findMembership(
          input.reporterId,
          asUuid(posting.organizationId),
        );

        if (membership) {
          throw new ForbiddenError("You cannot report your own posting.");
        }

        return {
          subjectType: "posting",
          summaryText: `${posting.name} ${posting.status} ${posting.organization.name}`,
          posting: {
            id: asUuid(posting.id),
            name: posting.name,
            status: posting.status,
            organization: {
              id: asUuid(posting.organization.id),
              name: posting.organization.name,
            },
          },
        };
      }
      case "posting_review": {
        const review = await this.reportsRepository.findPostingReviewSubject(
          asUuid(input.subjectId),
        );

        if (!review) {
          throw new ResourceNotFoundError("Review could not be found.");
        }

        if (review.reviewerId === input.reporterId) {
          throw new ForbiddenError("You cannot report your own review.");
        }

        const reviewer = this.toUserSummary(review.reviewer);
        const commentExcerpt = review.comment?.slice(0, 280) || undefined;

        return {
          subjectType: "posting_review",
          summaryText:
            `${review.posting.name} ${review.title ?? ""} ${commentExcerpt ?? ""} ${reviewer.username ?? reviewer.email}`.trim(),
          review: {
            id: asUuid(review.id),
            rating: review.rating,
            title: review.title ?? undefined,
            commentExcerpt,
            reviewer,
            posting: {
              id: asUuid(review.posting.id),
              name: review.posting.name,
            },
          },
        };
      }
      case "organization_blog_comment": {
        const comment =
          await this.reportsRepository.findOrganizationBlogCommentSubject(
            asUuid(input.subjectId),
          );

        // A tombstone is treated as gone: the text a reporter objected to is
        // already removed, and a report about it would give a moderator nothing
        // to act on.
        if (!comment || comment.deletedAt) {
          throw new ResourceNotFoundError("Comment could not be found.");
        }

        if (comment.authorUserId === input.reporterId) {
          throw new ForbiddenError("You cannot report your own comment.");
        }

        const author = this.toUserSummary(comment.author);
        const bodyExcerpt = comment.body.slice(0, 280) || undefined;

        return {
          subjectType: "organization_blog_comment",
          summaryText:
            `${comment.post.title} ${bodyExcerpt ?? ""} ${author.username ?? author.email}`.trim(),
          comment: {
            id: asUuid(comment.id),
            bodyExcerpt,
            author,
            post: {
              id: asUuid(comment.post.id),
              title: comment.post.title,
              slug: comment.post.slug,
              organization: {
                id: asUuid(comment.post.organization.id),
                name: comment.post.organization.name,
              },
            },
          },
        };
      }
      case "user": {
        const user = await this.reportsRepository.findUserSubject(
          asUuid(input.subjectId),
        );

        if (!user) {
          throw new ResourceNotFoundError("User could not be found.");
        }

        if (user.id === input.reporterId) {
          throw new ForbiddenError("You cannot report yourself.");
        }

        const summary = this.toUserSummary(user);
        return {
          subjectType: "user",
          summaryText: `${summary.username ?? summary.email} ${summary.role}`,
          user: summary,
        };
      }
    }
  }

  private resolveAssigneeId(input: AssignContentReportInput): Uuid | null {
    if (input.assignedModeratorId === undefined) {
      return input.actorUserId;
    }

    if (input.assignedModeratorId === null) {
      return null;
    }

    if (
      input.actorRole !== "admin" &&
      input.assignedModeratorId !== input.actorUserId
    ) {
      throw new ForbiddenError(
        "Only admins can assign reports to another moderator.",
      );
    }

    return input.assignedModeratorId;
  }

  private async assertAssignableModerator(
    assigneeId: Uuid | null,
  ): Promise<void> {
    if (!assigneeId) {
      return;
    }

    const assignee =
      await this.reportsRepository.findUserSummaryById(assigneeId);

    if (!assignee) {
      throw new ResourceNotFoundError("Assignee could not be found.");
    }

    if (!["moderator", "admin"].includes(assignee.role)) {
      throw new BadRequestError(
        "Reports can only be assigned to moderators or admins.",
      );
    }
  }

  private assertValidStatusTransition(
    currentStatus: ReportStatus,
    nextStatus: ReportStatus,
  ): void {
    const allowedTransitions: Record<ReportStatus, ReportStatus[]> = {
      open: ["under_review", "resolved", "dismissed"],
      under_review: ["resolved", "dismissed", "open"],
      resolved: ["under_review"],
      dismissed: ["under_review"],
    };

    if (currentStatus === nextStatus) {
      return;
    }

    if (!allowedTransitions[currentStatus].includes(nextStatus)) {
      throw new BadRequestError(
        "That report status transition is not allowed.",
      );
    }
  }

  private assertSafeTextContent(title: string, description: string): void {
    const violations = this.contentSanitizationService
      .inspect([
        {
          path: "title",
          value: title,
        },
        {
          path: "description",
          value: description,
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

  private assertSafeOptionalText(
    resolutionSummary?: string,
    note?: string,
  ): void {
    const textInputs = [
      ...(resolutionSummary
        ? [
            {
              path: "resolutionSummary",
              value: resolutionSummary,
            },
          ]
        : []),
      ...(note
        ? [
            {
              path: "note",
              value: note,
            },
          ]
        : []),
    ];

    if (textInputs.length === 0) {
      return;
    }

    const violations = this.contentSanitizationService
      .inspect(textInputs)
      .map((violation) => ({
        path: violation.path,
        message: violation.message,
      }));

    if (violations.length > 0) {
      throw new BadRequestError("Request body validation failed.", violations);
    }
  }

  private createPagination(
    page: number,
    pageSize: number,
    total: number,
  ): ListContentReportsResult["pagination"] {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  private toUserSummary(user: {
    id: string;
    email: string;
    role: AppRole | string;
    username?: string;
    avatarUrl?: string;
    profile?: {
      username?: string | null;
      avatarUrl?: string | null;
    } | null;
  }): ContentReportUserSummary {
    return {
      id: asUuid(user.id),
      email: user.email,
      role: normalizeAppRole(user.role),
      username: user.username ?? user.profile?.username ?? undefined,
      avatarUrl: user.avatarUrl ?? user.profile?.avatarUrl ?? undefined,
    };
  }
}
