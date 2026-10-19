import type { Role } from "@prisma/client";
import { ROLE_CAPABILITIES, type Capability } from "./permissions.js";

/** Structural shape of the user fields required for an API response. */
export interface UserLike {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: Role;
  restaurantId: string;
  preferredLanguage: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserResponse {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: Role;
  restaurantId: string;
  preferredLanguage: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  capabilities: Capability[];
}

/** Canonical user payload used by all auth/user endpoints (PRD §4.5). */
export function toUserResponse(u: UserLike): UserResponse {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone,
    role: u.role,
    restaurantId: u.restaurantId,
    preferredLanguage: u.preferredLanguage,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    capabilities: ROLE_CAPABILITIES[u.role] ?? [],
  };
}
