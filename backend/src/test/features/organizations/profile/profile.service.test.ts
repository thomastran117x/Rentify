import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { OrganizationProfileService } from "@/features/organizations/profile/profile.service";
import { OrganizationSlugTakenError } from "@/features/organizations/profile/profile.repository";
import { testUuid } from "../../../support/uuid";

const GHOST_ID = testUuid(9000, 332945);
const ORG_1_ID = testUuid(9000, 9234);
const USER_1_ID = testUuid(9000, 994257);

const NULL_ORGANIZATION_PROFILE = {
  description: null,
  websiteUrl: null,
  contactEmail: null,
  contactPhone: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  region: null,
  country: null,
  postalCode: null,
  logoUrl: null,
  logoBlobName: null,
  customFields: null,
};

function createUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_1_ID,
    email: "owner@example.com",
    emailVerified: true,
    preferredOrganizationId: ORG_1_ID,
    organizationMemberships: [],
    ...overrides,
  };
}

function createMembership(overrides: Record<string, unknown> = {}) {
  return {
    membershipId: "membership-1",
    role: "primary_manager",
    organization: {
      id: ORG_1_ID,
      slug: "northwind",
      name: "Northwind",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      ...NULL_ORGANIZATION_PROFILE,
    },
    ...overrides,
  };
}

function createService(overrides?: {
  repository?: Record<string, jest.Mock>;
  authRepository?: Record<string, jest.Mock>;
  auditService?: Record<string, jest.Mock>;
  invitationsService?: Record<string, jest.Mock>;
  logoService?: Record<string, jest.Mock>;
  postingProjectionService?: Record<string, jest.Mock>;
  publicSearchService?: Record<string, jest.Mock>;
}) {
  const repository = {
    createOrganizationWithOwner: jest.fn(async () => ({
      membershipId: "membership-9",
      id: "org-9",
      name: "Acme Rentals",
      role: "primary_manager" as const,
      joinedAt: "2026-06-01T00:00:00.000Z",
      isActive: true,
    })),
    findMembershipAccess: jest.fn(async () => createMembership()),
    findOrganizationDetail: jest.fn(async () => ({
      organization: {
        id: ORG_1_ID,
        name: "Northwind",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
      viewerRole: "operator",
      members: [],
      invitations: [],
    })),
    setPreferredOrganization: jest.fn(async () => undefined),
    updateOrganization: jest.fn(async () => ({
      id: ORG_1_ID,
      name: "Renamed",
      role: "operator",
      ...NULL_ORGANIZATION_PROFILE,
    })),
    resolveBySlug: jest.fn(async () => null),
    changeOrganizationSlug: jest.fn(async () => ({
      id: ORG_1_ID,
      slug: "northwind-creative",
      name: "Northwind",
      role: "operator" as const,
      ...NULL_ORGANIZATION_PROFILE,
    })),
    findPublicOrganizationDetail: jest.fn(async () => null),
    ...(overrides?.repository ?? {}),
  };
  const authRepository = {
    findUserById: jest.fn(async () => createUser()),
    ...(overrides?.authRepository ?? {}),
  };
  const auditService = {
    recordSafely: jest.fn(async () => undefined),
    ...(overrides?.auditService ?? {}),
  };
  const invitationsService = {
    expirePendingInvitations: jest.fn(async () => false),
    ...(overrides?.invitationsService ?? {}),
  };
  const logoService = {
    assertLogoInput: jest.fn(),
    cleanupReplacedLogo: jest.fn(async () => undefined),
    ...(overrides?.logoService ?? {}),
  };
  const postingProjectionService = {
    cascade: jest.fn(async () => undefined),
    ...(overrides?.postingProjectionService ?? {}),
  };
  const publicSearchService = {
    searchPublic: jest.fn(async () => ({
      organizations: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      source: "database",
    })),
    ...(overrides?.publicSearchService ?? {}),
  };

  return {
    service: new OrganizationProfileService(
      repository as any,
      repository as any,
      authRepository as any,
      auditService as any,
      invitationsService as any,
      logoService as any,
      postingProjectionService as any,
      publicSearchService as any,
    ),
    repository,
    authRepository,
    auditService,
    invitationsService,
    logoService,
    postingProjectionService,
    publicSearchService,
  };
}

describe("OrganizationProfileService", () => {
  it("creates an organization, assigns the creator as primary manager, and sets it active", async () => {
    const membership = {
      membershipId: "membership-9",
      id: "org-9",
      slug: "acme-rentals",
      name: "Acme Rentals",
      role: "primary_manager" as const,
      joinedAt: "2026-06-01T00:00:00.000Z",
      isActive: true,
    };
    const { service, repository } = createService({
      repository: {
        createOrganizationWithOwner: jest.fn(async () => membership),
      },
    });

    const result = await service.createOrganization({
      actorUserId: USER_1_ID,
      name: "  Acme Rentals  ",
    });

    // The slug is derived from the trimmed name.
    expect(repository.createOrganizationWithOwner).toHaveBeenCalledWith({
      name: "Acme Rentals",
      slug: "acme-rentals",
      ownerUserId: USER_1_ID,
    });
    expect(repository.setPreferredOrganization).toHaveBeenCalledWith(
      USER_1_ID,
      "org-9",
    );
    expect(result).toEqual({
      organization: {
        id: "org-9",
        slug: "acme-rentals",
        name: "Acme Rentals",
        role: "primary_manager",
      },
      membership: { ...membership, isActive: true },
    });
  });

  it("rejects organization creation for a missing user", async () => {
    const { service, repository } = createService({
      authRepository: {
        findUserById: jest.fn(async () => null),
      },
      repository: {
        createOrganizationWithOwner: jest.fn(async () => {
          throw new Error("should not be called");
        }),
      },
    });

    await expect(
      service.createOrganization({ actorUserId: GHOST_ID, name: "Acme" }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(repository.createOrganizationWithOwner).not.toHaveBeenCalled();
  });

  it("validates the logo input before writing, and cleans up a replaced logo after", async () => {
    const { service, logoService } = createService();

    await service.update({
      organizationId: ORG_1_ID,
      actorUserId: USER_1_ID,
      name: "Northwind",
    });

    expect(logoService.assertLogoInput).toHaveBeenCalledWith(
      USER_1_ID,
      expect.any(Object),
    );
    expect(logoService.cleanupReplacedLogo).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
      }),
    );
  });

  it("records an audit entry when renaming", async () => {
    const { service, repository, auditService } = createService();

    await expect(
      service.update({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        name: "  Better Northwind  ",
      }),
    ).resolves.toEqual({
      id: ORG_1_ID,
      name: "Renamed",
      role: "primary_manager",
    });
    expect(repository.updateOrganization).toHaveBeenCalledWith(
      ORG_1_ID,
      expect.objectContaining({ name: "Better Northwind" }),
    );
    expect(auditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "organization.renamed",
        changes: [
          {
            field: "name",
            before: "Northwind",
            after: "Renamed",
          },
        ],
      }),
    );
  });

  it("cascades posting projections with reindex when the name changes", async () => {
    const { service, postingProjectionService } = createService();

    await service.update({
      organizationId: ORG_1_ID,
      actorUserId: USER_1_ID,
      name: "Renamed",
    });

    expect(postingProjectionService.cascade).toHaveBeenCalledWith(ORG_1_ID, {
      reindex: true,
    });
  });

  it("does not cascade posting projections on a profile-only update", async () => {
    const { service, postingProjectionService } = createService({
      repository: {
        updateOrganization: jest.fn(async () => ({
          id: ORG_1_ID,
          name: "Northwind",
          role: "operator",
          ...NULL_ORGANIZATION_PROFILE,
          city: "Seattle",
        })),
      },
    });

    await service.update({
      organizationId: ORG_1_ID,
      actorUserId: USER_1_ID,
      name: "Northwind",
      city: "Seattle",
    });

    expect(postingProjectionService.cascade).not.toHaveBeenCalled();
  });

  it("threads profile fields through update and audits changed fields", async () => {
    const { service, repository, auditService } = createService({
      repository: {
        updateOrganization: jest.fn(async () => ({
          id: ORG_1_ID,
          name: "Northwind",
          role: "operator",
          ...NULL_ORGANIZATION_PROFILE,
          description: "Now with a description",
          city: "Seattle",
        })),
      },
    });

    await service.update({
      organizationId: ORG_1_ID,
      actorUserId: USER_1_ID,
      name: "Northwind",
      description: "Now with a description",
      city: "Seattle",
    });

    expect(repository.updateOrganization).toHaveBeenCalledWith(
      ORG_1_ID,
      expect.objectContaining({
        name: "Northwind",
        description: "Now with a description",
        city: "Seattle",
      }),
    );
    expect(auditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "organization.renamed",
        changes: expect.arrayContaining([
          {
            field: "description",
            before: null,
            after: "Now with a description",
          },
          { field: "city", before: null, after: "Seattle" },
        ]),
      }),
    );
  });

  it("never changes the slug on a routine profile update", async () => {
    const { service, repository } = createService();

    await service.update({
      organizationId: ORG_1_ID,
      actorUserId: USER_1_ID,
      name: "Renamed",
    });

    expect(repository.updateOrganization).toHaveBeenCalledWith(
      ORG_1_ID,
      expect.not.objectContaining({ slug: expect.anything() }),
    );
  });

  it("expires pending invitations while loading organization details", async () => {
    const refreshedDetail = {
      organization: {
        id: ORG_1_ID,
        name: "Northwind",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
      viewerRole: "operator",
      members: [],
      invitations: [{ id: "invite-1", status: "expired" }],
    };
    const { service, repository, invitationsService } = createService({
      repository: {
        findOrganizationDetail: jest
          .fn()
          .mockResolvedValueOnce({ ...refreshedDetail, invitations: [] })
          .mockResolvedValueOnce(refreshedDetail),
      },
      invitationsService: {
        expirePendingInvitations: jest.fn(async () => true),
      },
    });

    await expect(
      service.getWorkspaceById(ORG_1_ID, USER_1_ID),
    ).resolves.toEqual({
      ...refreshedDetail,
      viewerRole: "primary_manager",
    });
    expect(invitationsService.expirePendingInvitations).toHaveBeenCalledWith(
      ORG_1_ID,
      [],
    );
    expect(repository.findOrganizationDetail).toHaveBeenCalledTimes(2);
  });

  it("does not reload organization details when nothing expired", async () => {
    const { service, repository } = createService();

    await service.getWorkspaceById(ORG_1_ID, USER_1_ID);

    expect(repository.findOrganizationDetail).toHaveBeenCalledTimes(1);
  });

  describe("slug generation", () => {
    function slugTakenError() {
      return new OrganizationSlugTakenError("harbor-rentals");
    }

    it("derives the slug from the organization name on create", async () => {
      const { service, repository } = createService({
        repository: {
          createOrganizationWithOwner: jest.fn(async (input) => ({
            membershipId: "membership-9",
            id: "org-9",
            slug: (input as { slug: string }).slug,
            name: "Café Rentals",
            role: "primary_manager" as const,
            joinedAt: "2026-06-01T00:00:00.000Z",
            isActive: true,
          })),
        },
      });

      const result = await service.createOrganization({
        actorUserId: USER_1_ID,
        name: "Café Rentals",
      });

      // Diacritics are folded rather than dropped.
      expect(result.organization.slug).toBe("cafe-rentals");
      expect(repository.createOrganizationWithOwner).toHaveBeenCalledTimes(1);
    });

    it("retries the next candidate when the slug reservation rejects the insert", async () => {
      // Two concurrent creates with the same name both observe the slug as
      // free; the database arbitrates, so the loser must retry rather than 500.
      const createOrganizationWithOwner = jest
        .fn()
        .mockRejectedValueOnce(slugTakenError())
        .mockImplementation(async (input) => ({
          membershipId: "membership-9",
          id: "org-9",
          slug: (input as { slug: string }).slug,
          name: "Harbor Rentals",
          role: "primary_manager" as const,
          joinedAt: "2026-06-01T00:00:00.000Z",
          isActive: true,
        }));
      const { service } = createService({
        repository: { createOrganizationWithOwner },
      });

      const result = await service.createOrganization({
        actorUserId: USER_1_ID,
        name: "Harbor Rentals",
      });

      expect(createOrganizationWithOwner).toHaveBeenCalledTimes(2);
      expect(createOrganizationWithOwner.mock.calls[0]?.[0]?.slug).toBe(
        "harbor-rentals",
      );
      expect(result.organization.slug).toBe("harbor-rentals-2");
    });

    it("gives two organizations created with the same name distinct slugs", async () => {
      const claimed = new Set<string>();
      const createOrganizationWithOwner = jest.fn(async (input) => {
        const { slug } = input as { slug: string };
        if (claimed.has(slug)) {
          throw slugTakenError();
        }
        claimed.add(slug);
        return {
          membershipId: "membership-9",
          id: `org-${claimed.size}`,
          slug,
          name: "Harbor Rentals",
          role: "primary_manager" as const,
          joinedAt: "2026-06-01T00:00:00.000Z",
          isActive: true,
        };
      });
      const { service } = createService({
        repository: { createOrganizationWithOwner },
      });

      const [first, second] = await Promise.all([
        service.createOrganization({
          actorUserId: USER_1_ID,
          name: "Harbor Rentals",
        }),
        service.createOrganization({
          actorUserId: USER_1_ID,
          name: "Harbor Rentals",
        }),
      ]);

      expect(first.organization.slug).not.toBe(second.organization.slug);
      expect(claimed.size).toBe(2);
    });

    it("does not swallow an unrelated failure as a slug collision", async () => {
      const otherConflict = new Error("database exploded");
      const createOrganizationWithOwner = jest
        .fn()
        .mockRejectedValue(otherConflict);
      const { service } = createService({
        repository: { createOrganizationWithOwner },
      });

      await expect(
        service.createOrganization({
          actorUserId: USER_1_ID,
          name: "Harbor Rentals",
        }),
      ).rejects.toBe(otherConflict);
      expect(createOrganizationWithOwner).toHaveBeenCalledTimes(1);
    });

    it("skips past a retired slug when creating an organization", async () => {
      // A new organization named Harbor must not take `harbor` back off an
      // organization that retired it, or that organization's old links would
      // silently start resolving to the newcomer.
      const claimed = new Set(["harbor"]);
      const createOrganizationWithOwner = jest.fn(async (input) => {
        const { slug } = input as { slug: string };
        if (claimed.has(slug)) {
          throw new OrganizationSlugTakenError(slug);
        }
        claimed.add(slug);
        return {
          membershipId: "membership-9",
          id: "org-9",
          slug,
          name: "Harbor",
          role: "primary_manager" as const,
          joinedAt: "2026-06-01T00:00:00.000Z",
          isActive: true,
        };
      });
      const { service } = createService({
        repository: { createOrganizationWithOwner },
      });

      const result = await service.createOrganization({
        actorUserId: USER_1_ID,
        name: "Harbor",
      });

      expect(result.organization.slug).toBe("harbor-2");
    });

    it("generates a resolvable slug for a one-character organization name", async () => {
      // "A" slugifies to "a", which the slug route rejects as too short,
      // leaving the organization with a public URL that cannot resolve.
      const { service, repository } = createService({
        repository: {
          createOrganizationWithOwner: jest.fn(async (input) => ({
            membershipId: "membership-9",
            id: "org-9",
            slug: (input as { slug: string }).slug,
            name: "A",
            role: "primary_manager" as const,
            joinedAt: "2026-06-01T00:00:00.000Z",
            isActive: true,
          })),
        },
      });

      const result = await service.createOrganization({
        actorUserId: USER_1_ID,
        name: "A",
      });

      expect(result.organization.slug).toBe("a-org");
      expect(repository.createOrganizationWithOwner).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "a-org" }),
      );
    });

    it("generates a slug that cannot be mistaken for an organization id", async () => {
      const { service } = createService({
        repository: {
          createOrganizationWithOwner: jest.fn(async (input) => ({
            membershipId: "membership-9",
            id: "org-9",
            slug: (input as { slug: string }).slug,
            name: "uuid-named",
            role: "primary_manager" as const,
            joinedAt: "2026-06-01T00:00:00.000Z",
            isActive: true,
          })),
        },
      });

      const result = await service.createOrganization({
        actorUserId: USER_1_ID,
        name: "00000000-0000-0000-1040-000000000001",
      });

      expect(result.organization.slug).toBe(
        "org-00000000-0000-0000-1040-000000000001",
      );
    });

    it("generates a slug that does not shadow a sibling route", async () => {
      const { service } = createService({
        repository: {
          createOrganizationWithOwner: jest.fn(async (input) => ({
            membershipId: "membership-9",
            id: "org-9",
            slug: (input as { slug: string }).slug,
            name: "Invitations",
            role: "primary_manager" as const,
            joinedAt: "2026-06-01T00:00:00.000Z",
            isActive: true,
          })),
        },
      });

      const result = await service.createOrganization({
        actorUserId: USER_1_ID,
        name: "Invitations",
      });

      expect(result.organization.slug).toBe("invitations-org");
    });
  });

  describe("resolveBySlug", () => {
    it("resolves an organization by its canonical slug", async () => {
      const { service } = createService({
        repository: {
          resolveBySlug: jest.fn(async () => ({
            organizationId: ORG_1_ID,
            canonicalSlug: "northwind",
            name: "Northwind",
            matchedBy: "canonical-slug" as const,
          })),
        },
      });

      await expect(service.resolveBySlug("northwind")).resolves.toEqual({
        organizationId: ORG_1_ID,
        canonicalSlug: "northwind",
        name: "Northwind",
        matchedBy: "canonical-slug",
      });
    });

    it("resolves a retired slug and reports the canonical one", async () => {
      const { service } = createService({
        repository: {
          resolveBySlug: jest.fn(async () => ({
            organizationId: ORG_1_ID,
            canonicalSlug: "northwind-creative",
            name: "Northwind",
            matchedBy: "alias" as const,
          })),
        },
      });

      const resolved = await service.resolveBySlug("northwind");

      expect(resolved.matchedBy).toBe("alias");
      expect(resolved.canonicalSlug).toBe("northwind-creative");
    });

    it("throws when a slug matches no organization or alias", async () => {
      const { service } = createService({
        repository: { resolveBySlug: jest.fn(async () => null) },
      });

      await expect(service.resolveBySlug("nope")).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
    });
  });

  describe("changeSlug", () => {
    it("retires the previous slug as an alias when the URL changes", async () => {
      const changeOrganizationSlug = jest.fn(async () => ({
        id: ORG_1_ID,
        slug: "northwind-creative",
        name: "Northwind",
        role: "operator" as const,
        ...NULL_ORGANIZATION_PROFILE,
      }));
      const { service, auditService } = createService({
        repository: {
          resolveBySlug: jest.fn(async () => null),
          changeOrganizationSlug,
        },
      });

      const result = await service.changeSlug({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        slug: "northwind-creative",
      });

      expect(changeOrganizationSlug).toHaveBeenCalledWith({
        organizationId: ORG_1_ID,
        nextSlug: "northwind-creative",
      });
      expect(result.slug).toBe("northwind-creative");
      expect(auditService.recordSafely).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "organization.slug_changed",
          // Restoring would revive a slug another organization may since have
          // claimed, so the change is audited but not rewindable.
          restorable: false,
        }),
      );
    });

    it("refreshes cached posting projections on a slug change without reindexing", async () => {
      const { service, postingProjectionService } = createService({
        repository: {
          resolveBySlug: jest.fn(async () => null),
        },
      });

      await service.changeSlug({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        slug: "northwind-creative",
      });

      expect(postingProjectionService.cascade).toHaveBeenCalledWith(ORG_1_ID, {
        reindex: false,
      });
    });

    it("is a no-op when the slug is unchanged", async () => {
      const changeOrganizationSlug = jest.fn();
      const { service, auditService } = createService({
        repository: { changeOrganizationSlug },
      });

      const result = await service.changeSlug({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        slug: "northwind",
      });

      expect(changeOrganizationSlug).not.toHaveBeenCalled();
      expect(auditService.recordSafely).not.toHaveBeenCalled();
      expect(result.slug).toBe("northwind");
    });

    it("rejects a slug held by another organization, including as its alias", async () => {
      // resolveBySlug follows aliases, so a retired slug can never be
      // reassigned to a different organization and steal its old links.
      const resolveBySlug = jest.fn(async () => ({
        organizationId: "org-other",
        canonicalSlug: "someone-else",
        name: "Someone Else",
        matchedBy: "alias" as const,
      }));
      const changeOrganizationSlug = jest.fn();
      const { service } = createService({
        repository: { resolveBySlug, changeOrganizationSlug },
      });

      await expect(
        service.changeSlug({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          slug: "someone-elses-old-name",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(resolveBySlug).toHaveBeenCalledWith("someone-elses-old-name");
      expect(changeOrganizationSlug).not.toHaveBeenCalled();
    });

    it("refuses to re-adopt a slug this same organization already retired", async () => {
      // Aliases are only safe to serve as permanent (308) redirects because
      // they are never reused. After A -> B a client may hold a cached A -> B;
      // renaming back to A would make that cache bounce A -> B -> A forever.
      const changeOrganizationSlug = jest.fn();
      const { service } = createService({
        repository: {
          resolveBySlug: jest.fn(async () => ({
            organizationId: ORG_1_ID,
            canonicalSlug: "northwind",
            name: "Northwind",
            matchedBy: "alias" as const,
          })),
          changeOrganizationSlug,
        },
      });

      await expect(
        service.changeSlug({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          slug: "old-northwind",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(changeOrganizationSlug).not.toHaveBeenCalled();
    });

    it("translates a losing concurrent slug write into a conflict", async () => {
      const { service } = createService({
        repository: {
          resolveBySlug: jest.fn(async () => null),
          changeOrganizationSlug: jest.fn(async () => {
            throw slugTakenError();
          }),
        },
      });

      await expect(
        service.changeSlug({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          slug: "harbor-rentals",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("forbids a manager from changing the slug", async () => {
      const changeOrganizationSlug = jest.fn();
      const { service } = createService({
        repository: {
          findMembershipAccess: jest.fn(async () =>
            createMembership({ role: "manager" }),
          ),
          changeOrganizationSlug,
        },
      });

      await expect(
        service.changeSlug({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          slug: "harbor-rentals",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(changeOrganizationSlug).not.toHaveBeenCalled();
    });

    it("forbids an operator from changing the slug", async () => {
      const { service } = createService({
        repository: {
          findMembershipAccess: jest.fn(async () =>
            createMembership({ role: "operator" }),
          ),
        },
      });

      await expect(
        service.changeSlug({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          slug: "harbor-rentals",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    function slugTakenError() {
      return new OrganizationSlugTakenError("harbor-rentals");
    }
  });
});
