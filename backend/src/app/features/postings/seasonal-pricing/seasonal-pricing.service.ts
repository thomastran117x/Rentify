import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { OrganizationAuditService } from "@/features/organizations/organization-audit.service";
import type { SeasonalPricingRepository } from "@/features/postings/seasonal-pricing/seasonal-pricing.repository";
import type {
  SeasonalPricingRecord,
  UpsertSeasonalPricingBody,
} from "@/features/postings/seasonal-pricing/seasonal-pricing.model";

const MAX_SEASONAL_PRICING_RULES = 20;

export class SeasonalPricingService {
  constructor(
    private readonly seasonalPricingRepository: SeasonalPricingRepository,
    private readonly postingsRepository: PostingsRepository,
    private readonly organizationAccessService: OrganizationAccessService,
    private readonly organizationAuditService: OrganizationAuditService = {
      record: async () => undefined,
    } as unknown as OrganizationAuditService,
  ) {}

  async list(
    postingId: string,
    actorUserId: string,
  ): Promise<SeasonalPricingRecord[]> {
    await this.requireManagedPosting(postingId, actorUserId);
    return this.seasonalPricingRepository.listByPosting(postingId);
  }

  async create(
    postingId: string,
    actorUserId: string,
    body: UpsertSeasonalPricingBody,
  ): Promise<SeasonalPricingRecord> {
    const posting = await this.requireManagedPosting(postingId, actorUserId, "write");

    const count =
      await this.seasonalPricingRepository.countByPosting(postingId);
    if (count >= MAX_SEASONAL_PRICING_RULES) {
      throw new BadRequestError(
        `A posting can have at most ${MAX_SEASONAL_PRICING_RULES} seasonal pricing rules.`,
      );
    }

    const created = await this.seasonalPricingRepository.create({
      postingId,
      name: body.name,
      startDate: body.startDate,
      endDate: body.endDate,
      dailyAmount: body.dailyAmount,
    });

    await this.organizationAuditService.record({
      organizationId: posting.organizationId,
      actorUserId,
      action: "seasonal_pricing.created",
      resourceType: "seasonal_pricing",
      resourceId: created.id,
      summary: `${created.name} seasonal pricing was created for ${posting.name}.`,
      changes: [],
      afterSnapshot: created,
      restorable: false,
    });

    return created;
  }

  async update(
    postingId: string,
    ruleId: string,
    actorUserId: string,
    body: UpsertSeasonalPricingBody,
  ): Promise<SeasonalPricingRecord> {
    const posting = await this.requireManagedPosting(postingId, actorUserId, "write");
    const beforeRule =
      typeof this.seasonalPricingRepository.findById === "function"
        ? await this.seasonalPricingRepository.findById(ruleId, postingId)
        : null;

    const updated = await this.seasonalPricingRepository.update(
      ruleId,
      postingId,
      {
        name: body.name,
        startDate: body.startDate,
        endDate: body.endDate,
        dailyAmount: body.dailyAmount,
      },
    );

    if (!updated) {
      throw new ResourceNotFoundError(
        "Seasonal pricing rule could not be found.",
      );
    }

    await this.organizationAuditService.record({
      organizationId: posting.organizationId,
      actorUserId,
      action: "seasonal_pricing.updated",
      resourceType: "seasonal_pricing",
      resourceId: updated.id,
      summary: `${updated.name} seasonal pricing was updated for ${posting.name}.`,
      changes: this.createChanges(beforeRule, updated),
      beforeSnapshot: beforeRule ?? null,
      afterSnapshot: updated,
      restorable: true,
    });

    return updated;
  }

  async delete(
    postingId: string,
    ruleId: string,
    actorUserId: string,
  ): Promise<void> {
    const posting = await this.requireManagedPosting(postingId, actorUserId, "write");
    const beforeRule =
      typeof this.seasonalPricingRepository.findById === "function"
        ? await this.seasonalPricingRepository.findById(ruleId, postingId)
        : null;

    const deleted = await this.seasonalPricingRepository.delete(
      ruleId,
      postingId,
    );
    if (!deleted) {
      throw new ResourceNotFoundError(
        "Seasonal pricing rule could not be found.",
      );
    }

    await this.organizationAuditService.record({
      organizationId: posting.organizationId,
      actorUserId,
      action: "seasonal_pricing.deleted",
      resourceType: "seasonal_pricing",
      resourceId: beforeRule?.id ?? ruleId,
      summary: `${beforeRule?.name ?? "Seasonal pricing"} was deleted from ${posting.name}.`,
      changes: this.createChanges(beforeRule, null),
      beforeSnapshot: beforeRule ?? null,
      afterSnapshot: null,
      restorable: true,
    });
  }

  private createChanges(beforeSnapshot: unknown, afterSnapshot: unknown) {
    const beforeRecord = this.toRecord(beforeSnapshot);
    const afterRecord = this.toRecord(afterSnapshot);
    const keys = Array.from(
      new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]),
    );

    return keys
      .filter(
        (key) =>
          JSON.stringify(beforeRecord[key]) !== JSON.stringify(afterRecord[key]),
      )
      .map((key) => ({
        field: key,
        before: beforeRecord[key] ?? null,
        after: afterRecord[key] ?? null,
      }));
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }
  private async requireManagedPosting(
    postingId: string,
    actorUserId: string,
    access: "read" | "write" = "read",
  ) {
    const posting = await this.postingsRepository.findById(postingId);

    if (!posting) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    const membership = await this.organizationAccessService.findMembership(
      actorUserId,
      posting.organizationId,
    );

    if (!membership) {
      throw new ForbiddenError("You do not have access to this posting.");
    }

    if (access === "write") {
      const managerRoles = ["primary_manager", "manager"] as const;
      if (
        !managerRoles.includes(membership.role as (typeof managerRoles)[number])
      ) {
        throw new ForbiddenError(
          "Only managers can modify seasonal pricing rules.",
        );
      }
    }

    return posting;
  }
}




