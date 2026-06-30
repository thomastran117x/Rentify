import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
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
    await this.requireManagedPosting(postingId, actorUserId, "write");

    const count = await this.seasonalPricingRepository.countByPosting(postingId);
    if (count >= MAX_SEASONAL_PRICING_RULES) {
      throw new BadRequestError(
        `A posting can have at most ${MAX_SEASONAL_PRICING_RULES} seasonal pricing rules.`,
      );
    }

    return this.seasonalPricingRepository.create({
      postingId,
      name: body.name,
      startDate: body.startDate,
      endDate: body.endDate,
      dailyAmount: body.dailyAmount,
    });
  }

  async update(
    postingId: string,
    ruleId: string,
    actorUserId: string,
    body: UpsertSeasonalPricingBody,
  ): Promise<SeasonalPricingRecord> {
    await this.requireManagedPosting(postingId, actorUserId, "write");

    const updated = await this.seasonalPricingRepository.update(ruleId, postingId, {
      name: body.name,
      startDate: body.startDate,
      endDate: body.endDate,
      dailyAmount: body.dailyAmount,
    });

    if (!updated) {
      throw new ResourceNotFoundError("Seasonal pricing rule could not be found.");
    }

    return updated;
  }

  async delete(
    postingId: string,
    ruleId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.requireManagedPosting(postingId, actorUserId, "write");

    const deleted = await this.seasonalPricingRepository.delete(ruleId, postingId);
    if (!deleted) {
      throw new ResourceNotFoundError("Seasonal pricing rule could not be found.");
    }
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
      if (!managerRoles.includes(membership.role as (typeof managerRoles)[number])) {
        throw new ForbiddenError("Only managers can modify seasonal pricing rules.");
      }
    }

    return posting;
  }
}
