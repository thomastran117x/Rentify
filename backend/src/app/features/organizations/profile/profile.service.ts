import ConflictError from "@/errors/http/conflict.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { AuthRepository } from "@/features/auth/auth.repository";
import { requireExistingUser } from "@/features/organizations/require-existing-user";
import {
  requireOrganizationMembershipAccess,
  requirePrimaryManager,
} from "@/features/organizations/organization-membership-access";
import { createChanges } from "@/features/organizations/organization-audit-changes";
import type { OrganizationAuditService } from "@/features/organizations/audit/audit.service";
import type { OrganizationInvitationsService } from "@/features/organizations/invitations/invitations.service";
import type { OrganizationLogoService } from "@/features/organizations/organization-logo.service";
import type { OrganizationPostingProjectionService } from "@/features/organizations/organization-posting-projection.service";
import type { OrganizationsPublicSearchService } from "@/features/organizations/search/public-search.service";
import {
  ORGANIZATION_EDITABLE_FIELDS,
  pickOrganizationProfileInput,
  type OrganizationMembershipSummary,
  type OrganizationProfileInput,
  type OrganizationSummary,
} from "@/features/organizations/organizations.model";
import {
  OrganizationSlugTakenError,
  type OrganizationsRepository,
} from "@/features/organizations/organizations.repository";
import {
  ORGANIZATION_SLUG_MAX_LENGTH,
  generateShortSlugSuffix,
  nextSlugCandidate,
  slugify,
  toRouteSafeSlug,
  withSuffix,
} from "@/features/organizations/organization-slug";
import type {
  ChangeOrganizationSlugInput,
  CreateOrganizationInput,
  CreateOrganizationResult,
  ListPublicOrganizationsInput,
  PublicOrganizationDetailResult,
  PublicOrganizationListResult,
  UpdateOrganizationInput,
  OrganizationWorkspaceDetailResult,
} from "@/features/organizations/profile/profile.model";
import type { ResolvedOrganizationReference } from "@/features/organizations/organizations.model";

const CREATE_SLUG_ATTEMPTS = 10;

export class OrganizationProfileService {
  constructor(
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly authRepository: AuthRepository,
    private readonly organizationAuditService: OrganizationAuditService,
    private readonly organizationInvitationsService: OrganizationInvitationsService,
    private readonly organizationLogoService: OrganizationLogoService,
    private readonly organizationPostingProjectionService: OrganizationPostingProjectionService,
    private readonly organizationsPublicSearchService: OrganizationsPublicSearchService,
  ) {}

  async listPublic(
    input: ListPublicOrganizationsInput,
  ): Promise<PublicOrganizationListResult> {
    return this.organizationsPublicSearchService.searchPublic({
      page: input.page,
      pageSize: input.pageSize,
      query: input.query?.trim() || undefined,
      sort: input.sort,
    });
  }

  async getById(
    organizationId: string,
  ): Promise<PublicOrganizationDetailResult> {
    const detail =
      await this.organizationsRepository.findPublicOrganizationDetail(
        organizationId,
      );

    if (!detail) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    return detail;
  }

  async getWorkspaceById(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationWorkspaceDetailResult> {
    const membership = await requireOrganizationMembershipAccess(
      this.organizationsRepository,
      userId,
      organizationId,
    );
    let detail =
      await this.organizationsRepository.findOrganizationDetail(organizationId);

    if (!detail) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    if (
      await this.organizationInvitationsService.expirePendingInvitations(
        organizationId,
        detail.invitations,
      )
    ) {
      detail =
        await this.organizationsRepository.findOrganizationDetail(
          organizationId,
        );
    }

    if (!detail) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    return {
      ...detail,
      viewerRole: membership.role,
    };
  }

  async createOrganization(
    input: CreateOrganizationInput,
  ): Promise<CreateOrganizationResult> {
    await requireExistingUser(this.authRepository, input.actorUserId);

    const profile = pickOrganizationProfileInput(input);
    this.organizationLogoService.assertLogoInput(input.actorUserId, profile);
    const name = input.name.trim();
    const membership = await this.createOrganizationWithUniqueSlug({
      name,
      ownerUserId: input.actorUserId,
      profile,
    });

    await this.organizationsRepository.setPreferredOrganization(
      input.actorUserId,
      membership.id,
    );

    const afterSnapshot = {
      id: membership.id,
      name: membership.name,
      ...profile,
    };
    await this.organizationAuditService.recordSafely({
      organizationId: membership.id,
      actorUserId: input.actorUserId,
      action: "organization.created",
      resourceType: "organization",
      resourceId: membership.id,
      summary: `${membership.name} was created.`,
      changes: createChanges(null, afterSnapshot),
      afterSnapshot,
      restorable: false,
    });

    return {
      organization: {
        id: membership.id,
        slug: membership.slug,
        name: membership.name,
        role: membership.role,
      },
      membership: {
        ...membership,
        isActive: true,
      },
    };
  }

  /**
   * Insert the organization, letting the slug reservation arbitrate collisions.
   *
   * Probing for a free slug before inserting is racy: two concurrent creates
   * with the same name both observe `harbor-rentals` as free and one of them
   * fails on the constraint. Retrying on the constraint violation is what makes
   * concurrent creates correct, and reserving through the same key as renames is
   * what stops a new organization from claiming a retired slug.
   */
  private async createOrganizationWithUniqueSlug(input: {
    name: string;
    ownerUserId: string;
    profile: OrganizationProfileInput;
  }): Promise<OrganizationMembershipSummary> {
    const base = slugify(input.name, {
      maxLength: ORGANIZATION_SLUG_MAX_LENGTH,
      fallback: "organization",
    });

    for (let attempt = 0; attempt < CREATE_SLUG_ATTEMPTS; attempt += 1) {
      // Always route-safe: reserved, UUID-shaped, and too-short candidates are
      // adjusted rather than skipped, so creation cannot hand out a slug the
      // slug route would refuse to resolve.
      const candidate = nextSlugCandidate(
        base,
        attempt,
        ORGANIZATION_SLUG_MAX_LENGTH,
      );

      try {
        return await this.organizationsRepository.createOrganizationWithOwner({
          name: input.name,
          slug: candidate,
          ownerUserId: input.ownerUserId,
          ...input.profile,
        });
      } catch (error) {
        if (!(error instanceof OrganizationSlugTakenError)) {
          throw error;
        }
      }
    }

    // Still colliding after the readable candidates; fall back to a short
    // random suffix.
    for (let attempt = 0; attempt < CREATE_SLUG_ATTEMPTS; attempt += 1) {
      try {
        return await this.organizationsRepository.createOrganizationWithOwner({
          name: input.name,
          slug: toRouteSafeSlug(
            withSuffix(
              base,
              `-${generateShortSlugSuffix()}`,
              ORGANIZATION_SLUG_MAX_LENGTH,
            ),
            ORGANIZATION_SLUG_MAX_LENGTH,
          ),
          ownerUserId: input.ownerUserId,
          ...input.profile,
        });
      } catch (error) {
        if (!(error instanceof OrganizationSlugTakenError)) {
          throw error;
        }
      }
    }

    throw new ConflictError("Could not allocate an organization URL.");
  }

  async update(input: UpdateOrganizationInput): Promise<OrganizationSummary> {
    const membership = await requireOrganizationMembershipAccess(
      this.organizationsRepository,
      input.actorUserId,
      input.organizationId,
    );
    requirePrimaryManager(membership.role);

    const beforeSnapshot = membership.organization;
    const profile = pickOrganizationProfileInput(input);
    this.organizationLogoService.assertLogoInput(input.actorUserId, profile);
    const updated = await this.organizationsRepository.updateOrganization(
      input.organizationId,
      {
        name: input.name.trim(),
        ...profile,
      },
    );
    const afterSnapshot = {
      ...beforeSnapshot,
      ...updated,
    };

    const nameChanged = beforeSnapshot.name !== updated.name;
    const summary = nameChanged
      ? `Organization renamed from ${beforeSnapshot.name} to ${updated.name}.`
      : `${updated.name} profile was updated.`;

    await this.organizationAuditService.recordSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "organization.renamed",
      resourceType: "organization",
      resourceId: input.organizationId,
      summary,
      changes: createChanges(beforeSnapshot, afterSnapshot, [
        ...ORGANIZATION_EDITABLE_FIELDS,
      ]),
      beforeSnapshot,
      afterSnapshot,
      restorable: true,
    });

    await this.organizationLogoService.cleanupReplacedLogo({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      beforeSnapshot,
      afterSnapshot,
    });

    if (nameChanged) {
      await this.organizationPostingProjectionService.cascade(
        input.organizationId,
        { reindex: true },
      );
    }

    return {
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      role: membership.role,
    };
  }

  /**
   * Map a public URL slug (current or retired) onto an organization.
   */
  async resolveBySlug(slug: string): Promise<ResolvedOrganizationReference> {
    const resolved = await this.organizationsRepository.resolveBySlug(slug);

    if (!resolved) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    return resolved;
  }

  /**
   * Change an organization's public URL, retiring the previous slug as an
   * alias so existing links keep resolving.
   */
  async changeSlug(
    input: ChangeOrganizationSlugInput,
  ): Promise<OrganizationSummary> {
    const membership = await requireOrganizationMembershipAccess(
      this.organizationsRepository,
      input.actorUserId,
      input.organizationId,
    );
    requirePrimaryManager(membership.role);

    const previousSlug = membership.organization.slug;
    const nextSlug = input.slug;

    if (previousSlug === nextSlug) {
      return {
        id: membership.organization.id,
        slug: previousSlug,
        name: membership.organization.name,
        role: membership.role,
      };
    }

    // A slug that is in use, or that was ever retired, can never be adopted --
    // not even by the organization that previously held it.
    //
    // Reassigning another organization's slug would point its old links here.
    // Re-adopting one's own retired slug is just as unsafe: after A -> B, a
    // client may hold a cached permanent redirect A -> B, so renaming back to A
    // would make that cache bounce A -> B -> A indefinitely. Retired slugs are
    // only safe to serve as 308s because they are never reused.
    //
    // This read is for a clear error message only; the reservation's primary key
    // is what actually enforces it.
    const existing = await this.organizationsRepository.resolveBySlug(nextSlug);
    if (existing) {
      throw new ConflictError("That organization URL is already taken.");
    }

    let updated;
    try {
      updated = await this.organizationsRepository.changeOrganizationSlug({
        organizationId: input.organizationId,
        nextSlug,
      });
    } catch (error) {
      if (error instanceof OrganizationSlugTakenError) {
        throw new ConflictError("That organization URL is already taken.");
      }

      throw error;
    }

    await this.organizationAuditService.recordSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "organization.slug_changed",
      resourceType: "organization",
      resourceId: input.organizationId,
      summary: `Organization URL changed from ${previousSlug} to ${nextSlug}.`,
      changes: createChanges({ slug: previousSlug }, { slug: nextSlug }, [
        "slug",
      ]),
      beforeSnapshot: { slug: previousSlug },
      afterSnapshot: { slug: nextSlug },
      // Restoring would revive a slug that may since have been claimed, so slug
      // changes are audited but not rewindable.
      restorable: false,
    });

    // Slug is not indexed, so this only needs the cached projection refreshed.
    await this.organizationPostingProjectionService.cascade(
      input.organizationId,
      { reindex: false },
    );

    return {
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      role: membership.role,
    };
  }
}
