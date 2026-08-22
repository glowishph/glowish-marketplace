export interface PermissionDefinition {
  key: string;
  label: string;
  description: string;
  group: string;
}

/** Canonical list of every permission string checked anywhere in the app. */
export const PERMISSION_CATALOG: PermissionDefinition[] = [
  { key: "manage:branches", label: "Manage branches", description: "Create, edit, and assign users to branches", group: "Organization" },
  { key: "manage:users", label: "Manage users", description: "Create, edit, deactivate, and remove staff accounts", group: "Organization" },
  { key: "manage:organizations", label: "Manage organizations", description: "Manage distributor/franchise/partner organizations", group: "Organization" },
  { key: "manage:roles", label: "Manage roles & permissions", description: "Edit role permission sets and per-user overrides", group: "Organization" },
  { key: "manage:products", label: "Manage products", description: "Create, edit, and remove catalog products and variants", group: "Catalog" },
  { key: "manage:inventory", label: "Manage inventory", description: "Adjust stock levels, thresholds, and transfers", group: "Catalog" },
  { key: "view:org_inventory", label: "View organization inventory", description: "Read-only visibility into org-wide stock", group: "Catalog" },
  { key: "use:pos", label: "Use POS", description: "Access the point-of-sale terminal", group: "Sales" },
  { key: "manage:orders", label: "Manage orders", description: "View, update, and fulfill customer orders", group: "Sales" },
  { key: "submit:org_orders", label: "Submit organization orders", description: "Place purchase orders on behalf of an organization", group: "Sales" },
  { key: "manage:members", label: "Manage members", description: "Manage reseller/member accounts", group: "Sales" },
  { key: "view:own_orders", label: "View own orders", description: "See only orders placed by the current member", group: "Sales" },
  { key: "view:org_commissions", label: "View organization commissions", description: "Read-only visibility into commission payouts", group: "Sales" },
  { key: "view:reports", label: "View reports", description: "Access sales and performance reports", group: "Sales" },
  { key: "manage:promotions", label: "Manage promotions", description: "Create and edit coupons and spin-wheel promos", group: "Marketing" },
  { key: "manage:ads", label: "Manage ads", description: "Create and edit marketplace ad placements", group: "Marketing" },
  { key: "manage:blog", label: "Manage blog", description: "Create and edit blog posts", group: "Marketing" },
];

export const PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key);

export const PERMISSION_GROUPS = Array.from(new Set(PERMISSION_CATALOG.map((p) => p.group)));

export function isKnownPermission(key: string): boolean {
  return PERMISSION_KEYS.includes(key);
}
