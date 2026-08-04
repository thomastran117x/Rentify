import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import { normalizeAppRole, type AppRole } from "@/features/auth/auth.model";
import type {
  ContentReportDetailRecord,
  ContentReportEventRecord,
  ContentReportRecord,
  ContentReportSearchDocument,
  ContentReportSearchOutboxRecord,
  ContentReportSubjectSnapshot,
  ContentReportUserSummary,
  CreateContentReportInput,
  ListContentReportsInput,
  ListContentReportsResult,
  ReportPagination,
  ReportResolutionCode,
  ReportStatus,
  ReportSubjectType,
} from "@/features/reports/reports.model";

type UserSummaryPersistence = {
  id: string;
  email: string;
  role: string;
  profile: {
    username: string;
    avatarUrl: string | null;
  } | null;
};

type ReportPersistence = Prisma.ContentReportGetPayload<{
  include: {
    reporter: {
      include: {
        profile: true;
      };
    };
    assignedModerator: {
      include: {
        profile: true;
      };
    };
  };
}>;

type ReportDetailPersistence = Prisma.ContentReportGetPayload<{
  include: {
    reporter: {
      include: {
        profile: true;
      };
    };
    assignedModerator: {
      include: {
        profile: true;
      };
    };
    events: {
      include: {
        actor: {
          include: {
            profile: true;
          };
        };
      };
      orderBy: {
        createdAt: "asc";
      };
    };
  };
}>;

type EventPersistence = Prisma.ContentReportEventGetPayload<{
  include: {
    actor: {
      include: {
        profile: true;
      };
    };
  };
}>;

type ReportSearchOutboxPersistence =
  Prisma.ContentReportSearchOutboxGetPayload<object>;

type ReportSubjectPosting = {
  id: string;
  name: string;
  status: string;
  organizationId: string;
  organization: {
    id: string;
    name: string;
  };
};

type ReportSubjectReview = {
  id: string;
  rating: number;
  title: string | null;
  comment: string | null;
  reviewerId: string;
  reviewer: UserSummaryPersistence;
  posting: {
    id: string;
    name: string;
  };
};

export class ReportsRepository extends BaseRepository {
  async findPostingSubject(
    postingId: string,
  ): Promise<ReportSubjectPosting | null> {
    return this.executeAsync(() =>
      this.prisma.posting.findUnique({
        where: {
          id: postingId,
        },
        select: {
          id: true,
          name: true,
          status: true,
          organizationId: true,
          organization: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    );
  }

  async findPostingReviewSubject(
    reviewId: string,
  ): Promise<ReportSubjectReview | null> {
    return this.executeAsync(() =>
      this.prisma.postingReview.findUnique({
        where: {
          id: reviewId,
        },
        select: {
          id: true,
          rating: true,
          title: true,
          comment: true,
          reviewerId: true,
          reviewer: {
            select: {
              id: true,
              email: true,
              role: true,
              profile: {
                select: {
                  username: true,
                  avatarUrl: true,
                },
              },
            },
          },
          posting: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    );
  }

  async findUserSubject(
    userId: string,
  ): Promise<UserSummaryPersistence | null> {
    return this.executeAsync(() =>
      this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          id: true,
          email: true,
          role: true,
          profile: {
            select: {
              username: true,
              avatarUrl: true,
            },
          },
        },
      }),
    );
  }

  async createReport(
    input: CreateContentReportInput,
    subjectSnapshot: ContentReportSubjectSnapshot,
  ): Promise<ContentReportRecord> {
    const report = await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const created = await transaction.contentReport.create({
          data: {
            id: randomUUID(),
            reporterId: input.reporterId,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            reasonCode: input.reasonCode,
            title: input.title,
            description: input.description,
            subjectSnapshot:
              subjectSnapshot as unknown as Prisma.InputJsonValue,
            subjectSnapshotText: subjectSnapshot.summaryText,
          },
          include: {
            reporter: {
              include: {
                profile: true,
              },
            },
            assignedModerator: {
              include: {
                profile: true,
              },
            },
          },
        });

        await transaction.contentReportEvent.create({
          data: {
            id: randomUUID(),
            reportId: created.id,
            actorUserId: input.reporterId,
            eventType: "created",
            note: input.description,
          },
        });

        await transaction.contentReportSearchOutbox.create({
          data: {
            id: randomUUID(),
            reportId: created.id,
            operation: "upsert",
          },
        });

        return created;
      }),
    );

    return this.mapReport(report);
  }

  async findById(id: string): Promise<ContentReportDetailRecord | null> {
    const report = await this.executeAsync(() =>
      this.prisma.contentReport.findUnique({
        where: {
          id,
        },
        include: {
          reporter: {
            include: {
              profile: true,
            },
          },
          assignedModerator: {
            include: {
              profile: true,
            },
          },
          events: {
            include: {
              actor: {
                include: {
                  profile: true,
                },
              },
            },
            orderBy: {
              createdAt: "asc",
            },
          },
        },
      }),
    );

    return report ? this.mapReportDetail(report) : null;
  }

  async findReportRecordById(id: string): Promise<ContentReportRecord | null> {
    const report = await this.executeAsync(() =>
      this.prisma.contentReport.findUnique({
        where: {
          id,
        },
        include: {
          reporter: {
            include: {
              profile: true,
            },
          },
          assignedModerator: {
            include: {
              profile: true,
            },
          },
        },
      }),
    );

    return report ? this.mapReport(report) : null;
  }

  async findUserSummaryById(
    userId: string,
  ): Promise<ContentReportUserSummary | null> {
    const user = await this.findUserSubject(userId);
    return user ? this.mapUserSummary(user) : null;
  }

  async listReportsDb(
    input: ListContentReportsInput,
  ): Promise<Omit<ListContentReportsResult, "source">> {
    const where = this.createListWhere(input);
    const skip = (input.page - 1) * input.pageSize;

    const [reports, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.contentReport.findMany({
          where,
          skip,
          take: input.pageSize,
          orderBy: this.toOrderBy(input.sort),
          include: {
            reporter: {
              include: {
                profile: true,
              },
            },
            assignedModerator: {
              include: {
                profile: true,
              },
            },
          },
        }),
        this.prisma.contentReport.count({
          where,
        }),
      ]),
    );

    return {
      reports: reports.map((report) => this.mapReport(report)),
      pagination: this.createPagination(input.page, input.pageSize, total),
      ...(input.query ? { query: input.query } : {}),
    };
  }

  async findReportsByIds(ids: string[]): Promise<ContentReportRecord[]> {
    if (ids.length === 0) {
      return [];
    }

    const reports = await this.executeAsync(() =>
      this.prisma.contentReport.findMany({
        where: {
          id: {
            in: ids,
          },
        },
        include: {
          reporter: {
            include: {
              profile: true,
            },
          },
          assignedModerator: {
            include: {
              profile: true,
            },
          },
        },
      }),
    );
    const byId = new Map(reports.map((report) => [report.id, report]));

    return ids
      .map((id) => byId.get(id))
      .filter((report): report is ReportPersistence => Boolean(report))
      .map((report) => this.mapReport(report));
  }

  async updateAssignment(input: {
    reportId: string;
    actorUserId: string;
    assignedModeratorId: string | null;
  }): Promise<ContentReportRecord | null> {
    return this.executeAsync(async () => {
      try {
        const updated = await this.prisma.$transaction(async (transaction) => {
          const report = await transaction.contentReport.update({
            where: {
              id: input.reportId,
            },
            data: {
              assignedModeratorId: input.assignedModeratorId,
            },
            include: {
              reporter: {
                include: {
                  profile: true,
                },
              },
              assignedModerator: {
                include: {
                  profile: true,
                },
              },
            },
          });

          await transaction.contentReportEvent.create({
            data: {
              id: randomUUID(),
              reportId: report.id,
              actorUserId: input.actorUserId,
              eventType: "assigned",
              assignmentUserId: input.assignedModeratorId,
              note: input.assignedModeratorId
                ? "Moderator assignment updated."
                : "Report unassigned.",
            },
          });

          await transaction.contentReportSearchOutbox.create({
            data: {
              id: randomUUID(),
              reportId: report.id,
              operation: "upsert",
            },
          });

          return report;
        });

        return this.mapReport(updated);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          return null;
        }

        throw error;
      }
    });
  }

  async updateStatus(input: {
    reportId: string;
    actorUserId: string;
    status: ReportStatus;
    resolutionCode?: ReportResolutionCode;
    resolutionSummary?: string;
    note?: string;
  }): Promise<ContentReportRecord | null> {
    return this.executeAsync(async () => {
      try {
        const updated = await this.prisma.$transaction(async (transaction) => {
          const existing = await transaction.contentReport.findUnique({
            where: {
              id: input.reportId,
            },
            select: {
              status: true,
            },
          });

          if (!existing) {
            throw new Prisma.PrismaClientKnownRequestError("No report found", {
              code: "P2025",
              clientVersion: "unknown",
            });
          }

          const report = await transaction.contentReport.update({
            where: {
              id: input.reportId,
            },
            data: {
              status: input.status,
              resolutionCode: input.resolutionCode ?? null,
              resolutionSummary: input.resolutionSummary ?? null,
              reviewedAt:
                input.status === "resolved" || input.status === "dismissed"
                  ? new Date()
                  : null,
            },
            include: {
              reporter: {
                include: {
                  profile: true,
                },
              },
              assignedModerator: {
                include: {
                  profile: true,
                },
              },
            },
          });

          await transaction.contentReportEvent.create({
            data: {
              id: randomUUID(),
              reportId: report.id,
              actorUserId: input.actorUserId,
              eventType: input.note ? "note_added" : "status_changed",
              fromStatus: existing.status as ReportStatus,
              toStatus: input.status,
              note: input.note ?? input.resolutionSummary ?? null,
              metadata:
                input.note && existing.status === input.status
                  ? ({
                      status: input.status,
                    } as Prisma.InputJsonValue)
                  : undefined,
            },
          });

          await transaction.contentReportSearchOutbox.create({
            data: {
              id: randomUUID(),
              reportId: report.id,
              operation: "upsert",
            },
          });

          return report;
        });

        return this.mapReport(updated);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          return null;
        }

        throw error;
      }
    });
  }

  async claimSearchOutboxBatch(
    limit: number,
  ): Promise<ContentReportSearchOutboxRecord[]> {
    return this.executeAsync(async () => {
      const now = new Date();
      const ready = await this.prisma.contentReportSearchOutbox.findMany({
        where: {
          processedAt: null,
          deadLetteredAt: null,
          availableAt: {
            lte: now,
          },
          processingAt: null,
        },
        orderBy: {
          createdAt: "asc",
        },
        take: limit,
      });

      if (ready.length === 0) {
        return [];
      }

      await this.prisma.contentReportSearchOutbox.updateMany({
        where: {
          id: {
            in: ready.map((entry) => entry.id),
          },
        },
        data: {
          processingAt: now,
        },
      });

      return ready.map((entry) => this.mapSearchOutbox(entry, now));
    });
  }

  async listReportsForIndexing(
    reportIds: string[],
  ): Promise<ContentReportSearchDocument[]> {
    if (reportIds.length === 0) {
      return [];
    }

    const reports = await this.executeAsync(() =>
      this.prisma.contentReport.findMany({
        where: {
          id: {
            in: reportIds,
          },
        },
        include: {
          reporter: {
            include: {
              profile: true,
            },
          },
          assignedModerator: {
            include: {
              profile: true,
            },
          },
        },
      }),
    );

    return reports.map((report) => this.mapSearchDocument(report));
  }

  async markSearchOutboxProcessed(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.executeAsync(() =>
      this.prisma.contentReportSearchOutbox.updateMany({
        where: {
          id: {
            in: ids,
          },
        },
        data: {
          processedAt: new Date(),
          processingAt: null,
          lastError: null,
        },
      }),
    );
  }

  async retrySearchOutbox(
    id: string,
    attempts: number,
    errorMessage: string,
  ): Promise<void> {
    const retryDelayMs = Math.min(60_000, 1_000 * 2 ** Math.max(attempts, 1));

    await this.executeAsync(() =>
      this.prisma.contentReportSearchOutbox.update({
        where: {
          id,
        },
        data: {
          attempts,
          processingAt: null,
          availableAt: new Date(Date.now() + retryDelayMs),
          lastError: errorMessage.slice(0, 2048),
        },
      }),
    );
  }

  async markSearchOutboxDeadLettered(
    id: string,
    attempts: number,
    errorMessage: string,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.contentReportSearchOutbox.update({
        where: {
          id,
        },
        data: {
          attempts,
          processingAt: null,
          deadLetteredAt: new Date(),
          lastError: errorMessage.slice(0, 2048),
        },
      }),
    );
  }

  private createListWhere(
    input: ListContentReportsInput,
  ): Prisma.ContentReportWhereInput {
    return {
      ...(input.status ? { status: input.status } : {}),
      ...(input.subjectType ? { subjectType: input.subjectType } : {}),
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
      ...(input.assignedTo
        ? {
            assignedModeratorId:
              input.assignedTo === "unassigned" ? null : input.assignedTo,
          }
        : {}),
      ...(input.reporterId ? { reporterId: input.reporterId } : {}),
      ...(input.query
        ? {
            OR: [
              {
                title: {
                  contains: input.query,
                },
              },
              {
                description: {
                  contains: input.query,
                },
              },
              {
                subjectSnapshotText: {
                  contains: input.query,
                },
              },
            ],
          }
        : {}),
    };
  }

  private toOrderBy(
    sort: ListContentReportsInput["sort"],
  ): Prisma.ContentReportOrderByWithRelationInput[] {
    switch (sort) {
      case "oldest":
        return [{ createdAt: "asc" }];
      case "recentlyReviewed":
        return [{ reviewedAt: "desc" }, { createdAt: "desc" }];
      case "newest":
      default:
        return [{ createdAt: "desc" }];
    }
  }

  private mapReport(report: ReportPersistence): ContentReportRecord {
    return {
      id: report.id,
      reporterId: report.reporterId,
      subjectType: report.subjectType as ReportSubjectType,
      subjectId: report.subjectId,
      reasonCode: report.reasonCode,
      title: report.title,
      description: report.description,
      status: report.status as ReportStatus,
      resolutionCode: report.resolutionCode ?? undefined,
      resolutionSummary: report.resolutionSummary ?? undefined,
      reviewedAt: report.reviewedAt?.toISOString(),
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
      reporter: this.mapUserSummary(report.reporter),
      assignedModerator: report.assignedModerator
        ? this.mapUserSummary(report.assignedModerator)
        : undefined,
      subjectSnapshot:
        report.subjectSnapshot as unknown as ContentReportSubjectSnapshot,
    };
  }

  private mapReportDetail(
    report: ReportDetailPersistence,
  ): ContentReportDetailRecord {
    return {
      ...this.mapReport(report),
      events: report.events.map((event) => this.mapEvent(event)),
    };
  }

  private mapEvent(event: EventPersistence): ContentReportEventRecord {
    return {
      id: event.id,
      eventType: event.eventType,
      fromStatus: event.fromStatus as ReportStatus | undefined,
      toStatus: event.toStatus as ReportStatus | undefined,
      assignmentUserId: event.assignmentUserId ?? undefined,
      note: event.note ?? undefined,
      actor: this.mapUserSummary(event.actor),
      createdAt: event.createdAt.toISOString(),
    };
  }

  private mapUserSummary(
    user: UserSummaryPersistence,
  ): ContentReportUserSummary {
    return {
      id: user.id,
      email: user.email,
      username: user.profile?.username ?? undefined,
      avatarUrl: user.profile?.avatarUrl ?? undefined,
      role: normalizeAppRole(user.role),
    };
  }

  private mapSearchDocument(
    report: ReportPersistence,
  ): ContentReportSearchDocument {
    return {
      id: report.id,
      subjectType: report.subjectType as ReportSubjectType,
      subjectId: report.subjectId,
      reasonCode: report.reasonCode,
      status: report.status as ReportStatus,
      title: report.title,
      description: report.description,
      subjectSnapshotText: report.subjectSnapshotText,
      reporterId: report.reporter.id,
      reporterEmail: report.reporter.email,
      reporterUsername: report.reporter.profile?.username ?? undefined,
      reporterRole: normalizeAppRole(report.reporter.role),
      assignedModeratorId: report.assignedModerator?.id ?? undefined,
      assignedModeratorEmail: report.assignedModerator?.email ?? undefined,
      assignedModeratorUsername:
        report.assignedModerator?.profile?.username ?? undefined,
      assignedModeratorRole: report.assignedModerator
        ? normalizeAppRole(report.assignedModerator.role)
        : undefined,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
      reviewedAt: report.reviewedAt?.toISOString(),
    };
  }

  private mapSearchOutbox(
    outbox: ReportSearchOutboxPersistence,
    processingAt?: Date,
  ): ContentReportSearchOutboxRecord {
    return {
      id: outbox.id,
      reportId: outbox.reportId,
      operation: outbox.operation,
      attempts: outbox.attempts,
      availableAt: outbox.availableAt.toISOString(),
      processingAt: (
        processingAt ??
        outbox.processingAt ??
        undefined
      )?.toISOString(),
      processedAt: outbox.processedAt?.toISOString(),
      deadLetteredAt: outbox.deadLetteredAt?.toISOString(),
      lastError: outbox.lastError ?? undefined,
      createdAt: outbox.createdAt.toISOString(),
      updatedAt: outbox.updatedAt.toISOString(),
    };
  }

  private createPagination(
    page: number,
    pageSize: number,
    total: number,
  ): ReportPagination {
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
}
