import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { OrganizationsController } from "@/features/organizations/organizations.controller";
import {
  createPatPrincipal,
  createJwtClaims,
  createRouteTestApp,
} from "../../support/integration-app";

const organizationId = "00000000-0000-0000-1040-000000000001";
const inviteId = "22222222-2222-4222-8222-222222222222";
const memberId = "33333333-3333-4333-8333-333333333333";

function createApp() {
  const organizationsService = {
    listPublic: jest.fn(async () => ({
      organizations: [
        {
          id: organizationId,
          name: "Northwind",
          description: null,
          websiteUrl: null,
          addressLine1: null,
          addressLine2: null,
          city: null,
          region: null,
          country: null,
          postalCode: null,
          logoUrl: null,
          customFields: null,
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
          publishedPostingCount: 2,
        },
      ],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })),
    createOrganization: jest.fn(async () => ({
      organization: {
        id: organizationId,
        name: "Acme Rentals",
        role: "primary_manager",
      },
      membership: {
        membershipId: memberId,
        id: organizationId,
        name: "Acme Rentals",
        role: "primary_manager",
        joinedAt: "2026-06-01T00:00:00.000Z",
        isActive: true,
      },
    })),
    listMine: jest.fn(async () => ({
      memberships: [
        {
          membershipId: memberId,
          id: organizationId,
          name: "Northwind",
          role: "primary_manager",
          joinedAt: "2026-06-01T00:00:00.000Z",
          isActive: true,
        },
      ],
      activeOrganization: {
        id: organizationId,
        name: "Northwind",
        role: "primary_manager",
      },
    })),
    setActiveOrganization: jest.fn(async () => ({
      activeOrganization: {
        id: organizationId,
        name: "Northwind",
        role: "primary_manager",
      },
    })),
    previewInvitation: jest.fn(async () => ({
      invitation: {
        organizationId,
        organizationName: "Northwind",
        emailHint: "m***@example.com",
        role: "manager",
        status: "pending",
        expiresAt: "2026-06-08T00:00:00.000Z",
      },
      viewer: {
        authenticated: false,
        matchesEmail: false,
        canAccept: false,
      },
    })),
    acceptInvitation: jest.fn(async () => ({
      accepted: true,
      organization: {
        id: organizationId,
        name: "Northwind",
        role: "manager",
      },
      membership: {
        membershipId: memberId,
        id: organizationId,
        name: "Northwind",
        role: "manager",
        joinedAt: "2026-06-01T00:00:00.000Z",
        isActive: true,
      },
    })),
    getById: jest.fn(async () => ({
      organization: {
        id: organizationId,
        name: "Northwind",
        description: null,
        websiteUrl: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        region: null,
        country: null,
        postalCode: null,
        logoUrl: null,
        customFields: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        publishedPostingCount: 2,
      },
      stats: {
        publishedPostingCount: 2,
      },
    })),
    getWorkspaceById: jest.fn(async () => ({
      organization: {
        id: organizationId,
        name: "Northwind",
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
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
      viewerRole: "primary_manager",
      members: [],
      invitations: [],
    })),
    update: jest.fn(async () => ({
      id: organizationId,
      name: "Northwind Studios",
    })),
    createInvitation: jest.fn(async () => ({
      invitation: {
        id: inviteId,
        email: "manager@example.com",
        role: "manager",
        status: "pending",
      },
    })),
    revokeInvitation: jest.fn(async () => ({
      invitation: {
        id: inviteId,
        status: "revoked",
      },
    })),
    updateMemberRole: jest.fn(async () => ({
      member: {
        membershipId: memberId,
        role: "operator",
      },
    })),
    removeMember: jest.fn(async () => ({
      removed: true,
      membershipId: memberId,
    })),
  };

  const tokenService = {
    verifyAccessToken: jest.fn(async (token: string) => {
      if (token === "user-token") {
        return createJwtClaims({
          sub: "user-22",
          email: "user22@example.com",
          role: "user",
        });
      }

      return createJwtClaims({
        sub: "owner-1",
        email: "owner@example.com",
        role: "owner",
      });
    }),
  };
  const personalAccessTokenService = {
    authenticateToken: jest.fn(async () => createPatPrincipal()),
  };

  const registry = new Map<unknown, unknown>([
    [
      containerTokens.organizationsController,
      new OrganizationsController(organizationsService as any),
    ],
    [containerTokens.tokenService, tokenService],
    [containerTokens.personalAccessTokenService, personalAccessTokenService],
  ]);

  return {
    app: createRouteTestApp(registry),
    organizationsService,
    personalAccessTokenService,
  };
}

function authHeaders() {
  return {
    authorization: "Bearer owner-token",
    "content-type": "application/json",
  };
}

describe("Organizations integration", () => {
  it("covers public, workspace, invitation, and management endpoints", async () => {
    const { app, organizationsService } = createApp();

    const listPublicResponse = await app.request(
      `http://rent.test${buildApiPath("/organizations")}`,
    );
    const listPublicSortedResponse = await app.request(
      `http://rent.test${buildApiPath("/organizations")}?q=acme&sort=nameAsc`,
    );
    const createResponse = await app.request(
      `http://rent.test${buildApiPath("/organizations")}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: "Acme Rentals",
        }),
      },
    );
    const listMineResponse = await app.request(
      `http://rent.test${buildApiPath("/organizations/me")}`,
      {
        headers: authHeaders(),
      },
    );
    const setActiveResponse = await app.request(
      `http://rent.test${buildApiPath("/organizations/me/active")}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          organizationId,
        }),
      },
    );
    const previewResponse = await app.request(
      `http://rent.test${buildApiPath("/organizations/invitations/invite-token-1")}`,
    );
    const acceptResponse = await app.request(
      `http://rent.test${buildApiPath("/organizations/invitations/invite-token-1/accept")}`,
      {
        method: "POST",
        headers: authHeaders(),
      },
    );
    const getByIdResponse = await app.request(
      `http://rent.test${buildApiPath(`/organizations/${organizationId}`)}`,
    );
    const getWorkspaceByIdResponse = await app.request(
      `http://rent.test${buildApiPath(`/organizations/${organizationId}/workspace`)}`,
      {
        headers: authHeaders(),
      },
    );
    const updateResponse = await app.request(
      `http://rent.test${buildApiPath(`/organizations/${organizationId}`)}`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({
          name: "Northwind Studios",
        }),
      },
    );
    const createInvitationResponse = await app.request(
      `http://rent.test${buildApiPath(`/organizations/${organizationId}/invitations`)}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          email: "manager@example.com",
          role: "manager",
        }),
      },
    );
    const revokeInvitationResponse = await app.request(
      `http://rent.test${buildApiPath(`/organizations/${organizationId}/invitations/${inviteId}`)}`,
      {
        method: "DELETE",
        headers: authHeaders(),
      },
    );
    const updateMemberRoleResponse = await app.request(
      `http://rent.test${buildApiPath(`/organizations/${organizationId}/members/${memberId}`)}`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({
          role: "operator",
        }),
      },
    );
    const removeMemberResponse = await app.request(
      `http://rent.test${buildApiPath(`/organizations/${organizationId}/members/${memberId}`)}`,
      {
        method: "DELETE",
        headers: authHeaders(),
      },
    );

    expect(listPublicResponse.status).toBe(200);
    expect(listPublicSortedResponse.status).toBe(200);
    expect(createResponse.status).toBe(201);
    expect(listMineResponse.status).toBe(200);
    expect(setActiveResponse.status).toBe(200);
    expect(previewResponse.status).toBe(200);
    expect(acceptResponse.status).toBe(200);
    expect(getByIdResponse.status).toBe(200);
    expect(getWorkspaceByIdResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(createInvitationResponse.status).toBe(201);
    expect(revokeInvitationResponse.status).toBe(200);
    expect(updateMemberRoleResponse.status).toBe(200);
    expect(removeMemberResponse.status).toBe(200);

    expect(organizationsService.listPublic).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      query: undefined,
      sort: undefined,
    });
    // Free-text query and sort are parsed and forwarded to the search service.
    expect(organizationsService.listPublic).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      query: "acme",
      sort: "nameAsc",
    });
    expect(organizationsService.createOrganization).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      name: "Acme Rentals",
    });
    expect(organizationsService.listMine).toHaveBeenCalledWith("owner-1");
    expect(organizationsService.setActiveOrganization).toHaveBeenCalledWith({
      userId: "owner-1",
      organizationId,
    });
    expect(organizationsService.previewInvitation).toHaveBeenCalledWith({
      token: "invite-token-1",
      userId: undefined,
    });
    expect(organizationsService.acceptInvitation).toHaveBeenCalledWith({
      token: "invite-token-1",
      userId: "owner-1",
    });
    expect(organizationsService.getById).toHaveBeenCalledWith(organizationId);
    expect(organizationsService.getWorkspaceById).toHaveBeenCalledWith(
      organizationId,
      "owner-1",
    );
    expect(organizationsService.update).toHaveBeenCalledWith({
      organizationId,
      actorUserId: "owner-1",
      name: "Northwind Studios",
    });
    expect(organizationsService.createInvitation).toHaveBeenCalledWith({
      organizationId,
      actorUserId: "owner-1",
      email: "manager@example.com",
      role: "manager",
    });
    expect(organizationsService.revokeInvitation).toHaveBeenCalledWith({
      organizationId,
      actorUserId: "owner-1",
      invitationId: inviteId,
    });
    expect(organizationsService.updateMemberRole).toHaveBeenCalledWith({
      organizationId,
      actorUserId: "owner-1",
      membershipId: memberId,
      role: "operator",
    });
    expect(organizationsService.removeMember).toHaveBeenCalledWith({
      organizationId,
      actorUserId: "owner-1",
      membershipId: memberId,
    });
  });

  it("covers optional-auth invitation preview and common organizations failures", async () => {
    const { app, organizationsService, personalAccessTokenService } =
      createApp();

    const authenticatedPreviewResponse = await app.request(
      `http://rent.test${buildApiPath("/organizations/invitations/invite-token-1")}`,
      {
        headers: {
          authorization: "Bearer user-token",
        },
      },
    );
    const unauthorizedListResponse = await app.request(
      `http://rent.test${buildApiPath("/organizations/me")}`,
    );
    const invalidCreateResponse = await app.request(
      `http://rent.test${buildApiPath("/organizations")}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: "   ",
        }),
      },
    );
    const unauthorizedCreateResponse = await app.request(
      `http://rent.test${buildApiPath("/organizations")}`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "Acme Rentals",
        }),
      },
    );
    const invalidSetActiveResponse = await app.request(
      `http://rent.test${buildApiPath("/organizations/me/active")}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          organizationId: "not-a-uuid",
        }),
      },
    );
    const invalidOrganizationRouteResponse = await app.request(
      `http://rent.test${buildApiPath("/organizations/not-a-uuid")}`,
    );
    const invalidInvitePayloadResponse = await app.request(
      `http://rent.test${buildApiPath(`/organizations/${organizationId}/invitations`)}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          email: "bad-email",
          role: "viewer",
        }),
      },
    );
    const invalidMemberRoleResponse = await app.request(
      `http://rent.test${buildApiPath(`/organizations/${organizationId}/members/${memberId}`)}`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({
          role: "viewer",
        }),
      },
    );
    const patResponse = await app.request(
      `http://rent.test${buildApiPath("/organizations/me")}`,
      {
        headers: {
          authorization:
            "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
        },
      },
    );

    expect(authenticatedPreviewResponse.status).toBe(200);
    expect(organizationsService.previewInvitation).toHaveBeenLastCalledWith({
      token: "invite-token-1",
      userId: "user-22",
    });

    expect(unauthorizedListResponse.status).toBe(401);
    await expect(unauthorizedListResponse.json()).resolves.toEqual({
      success: false,
      message: "Authorization header is required.",
      data: null,
      error: {
        code: "UNAUTHORIZED",
      },
      meta: {
        requestId: "unknown",
      },
    });

    expect(invalidCreateResponse.status).toBe(400);
    await expect(invalidCreateResponse.json()).resolves.toMatchObject({
      success: false,
      message: "Request body validation failed.",
      error: {
        code: "VALIDATION_ERROR",
      },
    });

    expect(unauthorizedCreateResponse.status).toBe(401);
    expect(organizationsService.createOrganization).not.toHaveBeenCalled();

    expect(invalidSetActiveResponse.status).toBe(400);
    await expect(invalidSetActiveResponse.json()).resolves.toMatchObject({
      success: false,
      message: "Request body validation failed.",
      error: {
        code: "VALIDATION_ERROR",
      },
    });

    expect(invalidOrganizationRouteResponse.status).toBe(400);
    await expect(
      invalidOrganizationRouteResponse.json(),
    ).resolves.toMatchObject({
      success: false,
      message: "Route parameter validation failed.",
      error: {
        code: "VALIDATION_ERROR",
      },
    });

    expect(invalidInvitePayloadResponse.status).toBe(400);
    await expect(invalidInvitePayloadResponse.json()).resolves.toMatchObject({
      success: false,
      message: "Request body validation failed.",
      error: {
        code: "VALIDATION_ERROR",
      },
    });

    expect(invalidMemberRoleResponse.status).toBe(400);
    await expect(invalidMemberRoleResponse.json()).resolves.toMatchObject({
      success: false,
      message: "Request body validation failed.",
      error: {
        code: "VALIDATION_ERROR",
      },
    });

    expect(patResponse.status).toBe(403);
    await expect(patResponse.json()).resolves.toEqual({
      success: false,
      message: "Personal access tokens cannot access this endpoint.",
      data: null,
      error: {
        code: "FORBIDDEN",
        details: {
          method: "GET",
          pathname: "/organizations/me",
          authMethod: "pat",
        },
      },
      meta: {
        requestId: "unknown",
      },
    });
    expect(personalAccessTokenService.authenticateToken).toHaveBeenCalledTimes(
      1,
    );
  });
});
