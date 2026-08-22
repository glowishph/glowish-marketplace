import type { UserRole } from "@/types";

/** Roles with full platform access (bypass permission checks). */
export const PLATFORM_ADMIN_ROLES: readonly UserRole[] = ["ADMIN"];

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  ADMIN: [
    "manage:branches",
    "manage:users",
    "manage:products",
    "manage:inventory",
    "use:pos",
    "view:reports",
    "manage:members",
    "manage:orders",
    "manage:organizations",
    "manage:roles",
    "manage:ads",
    "manage:blog",
    "manage:promotions",
  ],
  ORG_ADMIN: [
    "manage:organizations",
    "manage:users",
    "manage:inventory",
    "use:pos",
    "manage:orders",
    "view:reports",
    "submit:org_orders",
    "view:org_inventory",
    "view:org_commissions",
  ],
  BRANCH_MANAGER: [
    "manage:products",
    "manage:inventory",
    "use:pos",
    "view:reports",
    "manage:members",
    "manage:orders",
  ],
  STAFF: ["use:pos", "manage:members", "manage:orders"],
  INVENTORY_MANAGER: ["manage:products", "manage:inventory", "view:reports"],
  MEMBER: ["view:own_orders"],
  CUSTOMER: [],
};

export type PermissionSubject = {
  role: UserRole | string;
  permissions?: string[] | null;
};

export function isPlatformAdmin(role: string | undefined | null): boolean {
  return role != null && PLATFORM_ADMIN_ROLES.includes(role as UserRole);
}

/** Role defaults merged with user-specific grants (same as login). */
export function effectivePermissions(user: PermissionSubject): string[] {
  const role = user.role as UserRole;
  const roleDefaults = DEFAULT_ROLE_PERMISSIONS[role] ?? [];
  const extra = user.permissions ?? [];
  return Array.from(new Set([...roleDefaults, ...extra]));
}

/**
 * Checks a user's already-resolved `permissions` array directly (no re-merge with
 * {@link DEFAULT_ROLE_PERMISSIONS}). That array is the authoritative, DB-derived
 * effective set computed at login/impersonation time — re-merging it with the code
 * defaults here would silently resurrect any permission an admin removed from a
 * role via the Roles & Permissions editor.
 */
export function hasPermission(user: PermissionSubject, ...required: string[]): boolean {
  if (isPlatformAdmin(user.role)) return true;
  if (!required.length) return true;
  const effective = user.permissions ?? [];
  return required.every((p) => effective.includes(p));
}

export function hasAnyPermission(user: PermissionSubject, ...anyOf: string[]): boolean {
  if (isPlatformAdmin(user.role)) return true;
  if (!anyOf.length) return true;
  const effective = user.permissions ?? [];
  return anyOf.some((p) => effective.includes(p));
}
