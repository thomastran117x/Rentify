import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { loggerFactory } from "@/configuration/logging";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { OrganizationAuditService } from "@/features/organizations/audit/audit.service";
import { createAuditChanges } from "@/features/organizations/audit/audit.model";
import type { SeasonalPricingRepository } from "@/features/postings/seasonal-pricing/seasonal-pricing.repository";
import type {
  SeasonalPricingRecord,
  UpsertSeasonalPricingBody,
} from "@/features/postings/seasonal-pricing/seasonal-pricing.model";
import type { Uuid } from "@/configuration/validation/uuid";

const MAX_SEASONAL_PRICING_RULES = 20;

export class SeasonalPricingService {
  private readonly logger = loggerFactory.forClass(
    SeasonalPricingService,
    "service",
  );

  constructor(
    private readonly seasonalPricingRepository: SeasonalPricingRepository,
    private readonly postingsRepository: PostingsRepository,
    private readonly organizationAccessService: OrganizationAccessService,
    private readonly organizationAuditService: OrganizationAuditService,
  ) {}

  async list(
    postingId: Uuid,
    actorUserId: Uuid,
  ): Promise<SeasonalPricingRecord[]> {
    await this.requireManagedPosting(postingId, actorUserId);
    return this.seasonalPricingRepository.listByPosting(postingId);
  }

  async create(
    postingId: Uuid,
    actorUserId: Uuid,
    body: UpsertSeasonalPricingBody,
  ): Promise<SeasonalPricingRecord> {
    const posting = await this.requireManagedPosting(
      postingId,
      actorUserId,
      "write",
    );

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

    await this.recordAuditSafely({
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
    postingId: Uuid,
    ruleId: string,
    actorUserId: Uuid,
    body: UpsertSeasonalPricingBody,
  ): Promise<SeasonalPricingRecord> {
    const posting = await this.requireManagedPosting(
      postingId,
      actorUserId,
      "write",
    );
    const beforeRule = await this.seasonalPricingRepository.findById(
      ruleId,
      postingId,
    );

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

    await this.recordAuditSafely({
      organizationId: posting.organizationId,
      actorUserId,
      action: "seasonal_pricing.updated",
      resourceType: "seasonal_pricing",
      resourceId: updated.id,
      summary: `${updated.name} seasonal pricing was updated for ${posting.name}.`,
      changes: createAuditChanges(beforeRule, updated),
      beforeSnapshot: beforeRule ?? null,
      afterSnapshot: updated,
      restorable: true,
    });

    return updated;
  }

  async delete(
    postingId: Uuid,
    ruleId: string,
    actorUserId: Uuid,
  ): Promise<void> {
    const posting = await this.requireManagedPosting(
      postingId,
      actorUserId,
      "write",
    );
    const beforeRule = await this.seasonalPricingRepository.findById(
      ruleId,
      postingId,
    );

    const deleted = await this.seasonalPricingRepository.delete(
      ruleId,
      postingId,
    );
    if (!deleted) {
      throw new ResourceNotFoundError(
        "Seasonal pricing rule could not be found.",
      );
    }

    await this.recordAuditSafely({
      organizationId: posting.organizationId,
      actorUserId,
      action: "seasonal_pricing.deleted",
      resourceType: "seasonal_pricing",
      resourceId: beforeRule?.id ?? ruleId,
      summary: `${beforeRule?.name ?? "Seasonal pricing"} was deleted from ${posting.name}.`,
      changes: createAuditChanges(beforeRule, null),
      beforeSnapshot: beforeRule ?? null,
      afterSnapshot: null,
      restorable: true,
    });
  }

  private async recordAuditSafely(
    input: Parameters<OrganizationAuditService["record"]>[0],
  ): Promise<void> {
    try {
      await this.organizationAuditService.record(input);
    } catch (error) {
      this.logger.error("Failed to record seasonal pricing audit entry.", {
        organizationId: input.organizationId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? undefined,
        error,
      });
    }
  }

  private async requireManagedPosting(
    postingId: Uuid,
    actorUserId: Uuid,
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
