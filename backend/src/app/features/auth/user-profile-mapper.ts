import type {
  AuthActiveOrganizationSummary,
  AuthUserOrganizationMembershipRecord,
  AuthUserProfile,
  AuthUserRecord,
} from "@/features/auth/auth.model";

function readOrganizationMemberships(
  user: AuthUserRecord,
): AuthUserOrganizationMembershipRecord[] {
  return Array.isArray(user.organizationMemberships)
    ? user.organizationMemberships
    : [];
}

function resolveActiveOrganization(
  user: AuthUserRecord,
): AuthActiveOrganizationSummary | undefined {
  const organizationMemberships = readOrganizationMemberships(user);
  const activeMembership =
    organizationMemberships.find(
      (membership) => membership.organizationId === user.preferredOrganizationId,
    ) ?? organizationMemberships[0];

  if (!activeMembership) {
    return undefined;
  }

  return {
    id: activeMembership.organizationId,
    name: activeMembership.organizationName,
    role: activeMembership.role,
  };
}

export function toAuthUserProfile(user: AuthUserRecord): AuthUserProfile {
  const activeOrganization = resolveActiveOrganization(user);
  const organizationMemberships = readOrganizationMemberships(user);

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.profile.username,
    phoneNumber: user.profile.phoneNumber,
    avatarUrl: user.profile.avatarUrl,
    isPrivate: user.profile.isPrivate,
    recommendationPersonalizationEnabled:
      user.profile.recommendationPersonalizationEnabled,
    trustworthinessScore: user.profile.trustworthinessScore,
    rentPostingsCount: user.profile.rentPostingsCount,
    availableRentPostingsCount: user.profile.availableRentPostingsCount,
    role: user.role,
    emailVerified: user.emailVerified,
    activeOrganization,
    organizationMembershipCount: organizationMemberships.length,
  };
}
