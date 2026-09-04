import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { SeasonalPricingService } from "@/features/postings/seasonal-pricing/seasonal-pricing.service";
import type { SeasonalPricingRepository } from "@/features/postings/seasonal-pricing/seasonal-pricing.repository";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { OrganizationAuditService } from "@/features/organizations/audit/audit.service";
import type { SeasonalPricingRecord } from "@/features/postings/seasonal-pricing/seasonal-pricing.model";
import { testUuid } from "../../support/uuid";
const OWNER_1_ID = testUuid(9000, 219201);
const POSTING_1_ID = testUuid(9000, 254272);

const RULE_1_ID = testUuid(9000, 148479);

function buildRule(
  overrides: Partial<SeasonalPricingRecord> = {},
): SeasonalPricingRecord {
  return {
    id: RULE_1_ID,
    postingId: POSTING_1_ID,
    name: "Summer Peak",
    startDate: "2026-06-01",
    endDate: "2026-08-31",
    dailyAmount: 150,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildBody() {
  return {
    name: "Summer Peak",
    startDate: "2026-06-01",
    endDate: "2026-08-31",
    dailyAmount: 150,
  };
}

function createService(options?: {
  rules?: SeasonalPricingRecord[];
  ruleCount?: number;
  updatedRule?: SeasonalPricingRecord | null;
  deletedRule?: boolean;
  posting?: Record<string, unknown> | null;
  membershipRole?: string | null;
}) {
  const rules = options?.rules ?? [buildRule()];

  const seasonalPricingRepository = {
    listByPosting: jest.fn(async () => rules),
    countByPosting: jest.fn(async () => options?.ruleCount ?? 0),
    create: jest.fn(async () => buildRule()),
    findById: jest.fn(async () => rules[0] ?? null),
    // Use explicit key check so `updatedRule: null` returns null rather than fallback
    update: jest.fn(async () =>
      options !== undefined && "updatedRule" in options
        ? options.updatedRule
        : buildRule(),
    ),
    delete: jest.fn(async () => options?.deletedRule ?? true),
  } as unknown as SeasonalPricingRepository;

  const posting =
    options?.posting === null
      ? null
      : {
          id: POSTING_1_ID,
          organizationId: "org-1",
          status: "published",
          ...(options?.posting ?? {}),
        };

  const postingsRepository = {
    findById: jest.fn(async () => posting),
  } as unknown as PostingsRepository;

  const role =
    options?.membershipRole === undefined
      ? "primary_manager"
      : options.membershipRole;
  const membership =
    role === null
      ? null
      : { organizationId: "org-1", userId: OWNER_1_ID, role };

  const organizationAccessService = {
    findMembership: jest.fn(async () => membership),
  } as unknown as OrganizationAccessService;
  const organizationAuditService = {
    record: jest.fn(async () => undefined),
  } as unknown as OrganizationAuditService;

  return {
    service: new SeasonalPricingService(
      seasonalPricingRepository,
      postingsRepository,
      organizationAccessService,
      organizationAuditService,
    ),
    seasonalPricingRepository,
    postingsRepository,
    organizationAccessService,
  };
}

describe("SeasonalPricingService", () => {
  describe("list", () => {
    it("returns rules for a posting the actor manages", async () => {
      const { service } = createService();

      const result = await service.list(POSTING_1_ID, OWNER_1_ID);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: RULE_1_ID,
        postingId: POSTING_1_ID,
      });
    });

    it("throws ResourceNotFoundError when posting does not exist", async () => {
      const { service } = createService({ posting: null });

      await expect(
        service.list(POSTING_1_ID, OWNER_1_ID),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("throws ForbiddenError when actor is not a member of the organization", async () => {
      const { service } = createService({ membershipRole: null });

      await expect(
        service.list(POSTING_1_ID, OWNER_1_ID),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("allows non-manager members (viewer role) to list rules", async () => {
      const { service } = createService({ membershipRole: "viewer" });

      await expect(
        service.list(POSTING_1_ID, OWNER_1_ID),
      ).resolves.toBeDefined();
    });
  });

  describe("create", () => {
    it("creates a rule for a manager", async () => {
      const { service, seasonalPricingRepository } = createService();

      const result = await service.create(
        POSTING_1_ID,
        OWNER_1_ID,
        buildBody(),
      );

      expect(result).toMatchObject({ id: RULE_1_ID });
      expect(seasonalPricingRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          postingId: POSTING_1_ID,
          name: "Summer Peak",
          dailyAmount: 150,
        }),
      );
    });

    it("throws BadRequestError when the 20-rule cap is reached", async () => {
      const { service } = createService({ ruleCount: 20 });

      await expect(
        service.create(POSTING_1_ID, OWNER_1_ID, buildBody()),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("throws ForbiddenError when actor has viewer role (not manager)", async () => {
      const { service } = createService({ membershipRole: "viewer" });

      await expect(
        service.create(POSTING_1_ID, OWNER_1_ID, buildBody()),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws ForbiddenError when actor is not a member", async () => {
      const { service } = createService({ membershipRole: null });

      await expect(
        service.create(POSTING_1_ID, OWNER_1_ID, buildBody()),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws ResourceNotFoundError when posting does not exist", async () => {
      const { service } = createService({ posting: null });

      await expect(
        service.create(POSTING_1_ID, OWNER_1_ID, buildBody()),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("allows create when count is exactly 19 (one below cap)", async () => {
      const { service, seasonalPricingRepository } = createService({
        ruleCount: 19,
      });

      await expect(
        service.create(POSTING_1_ID, OWNER_1_ID, buildBody()),
      ).resolves.toBeDefined();
      expect(seasonalPricingRepository.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("update", () => {
    it("updates a rule and returns the updated record", async () => {
      const updated = buildRule({ name: "Updated Name", dailyAmount: 200 });
      const { service, seasonalPricingRepository } = createService({
        updatedRule: updated,
      });

      const result = await service.update(POSTING_1_ID, RULE_1_ID, OWNER_1_ID, {
        ...buildBody(),
        name: "Updated Name",
        dailyAmount: 200,
      });

      expect(result.name).toBe("Updated Name");
      expect(result.dailyAmount).toBe(200);
      expect(seasonalPricingRepository.update).toHaveBeenCalledWith(
        RULE_1_ID,
        POSTING_1_ID,
        expect.objectContaining({ name: "Updated Name", dailyAmount: 200 }),
      );
    });

    it("throws ResourceNotFoundError when the rule does not belong to the posting", async () => {
      const { service } = createService({ updatedRule: null });

      await expect(
        service.update(
          POSTING_1_ID,
          "nonexistent-rule",
          OWNER_1_ID,
          buildBody(),
        ),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("throws ForbiddenError when actor is a viewer", async () => {
      const { service } = createService({ membershipRole: "viewer" });

      await expect(
        service.update(POSTING_1_ID, RULE_1_ID, OWNER_1_ID, buildBody()),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("delete", () => {
    it("deletes a rule successfully", async () => {
      const { service, seasonalPricingRepository } = createService({
        deletedRule: true,
      });

      await expect(
        service.delete(POSTING_1_ID, RULE_1_ID, OWNER_1_ID),
      ).resolves.toBeUndefined();
      expect(seasonalPricingRepository.delete).toHaveBeenCalledWith(
        RULE_1_ID,
        POSTING_1_ID,
      );
    });

    it("throws ResourceNotFoundError when rule does not exist", async () => {
      const { service } = createService({ deletedRule: false });

      await expect(
        service.delete(POSTING_1_ID, "nonexistent-rule", OWNER_1_ID),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("throws ForbiddenError when actor lacks manager role", async () => {
      const { service } = createService({ membershipRole: "viewer" });

      await expect(
        service.delete(POSTING_1_ID, RULE_1_ID, OWNER_1_ID),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("allows delete by a 'manager' role (not only primary_manager)", async () => {
      const { service, seasonalPricingRepository } = createService({
        membershipRole: "manager",
        deletedRule: true,
      });

      await expect(
        service.delete(POSTING_1_ID, RULE_1_ID, OWNER_1_ID),
      ).resolves.toBeUndefined();
      expect(seasonalPricingRepository.delete).toHaveBeenCalledTimes(1);
    });
  });
});
