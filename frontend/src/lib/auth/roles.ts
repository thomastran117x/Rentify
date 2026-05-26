import type { AuthResponseUser } from "@/lib/auth/types";

export type AppUserRole = AuthResponseUser["role"];

export function isOwnerRole(role?: AppUserRole): boolean {
  return role === "owner" || role === "admin";
}

export function isModeratorRole(role?: AppUserRole): boolean {
  return role === "moderator" || role === "admin";
}

export function isMarketplaceUserRole(role?: AppUserRole): boolean {
  return role === "user" || isOwnerRole(role) || isModeratorRole(role);
}
