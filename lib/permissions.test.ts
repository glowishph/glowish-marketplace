import { describe, expect, it } from "vitest";
import { effectivePermissions, hasPermission, hasAnyPermission } from "@/lib/permissions";

describe("permissions", () => {
  it("merges role defaults with user grants", () => {
    const perms = effectivePermissions({
      role: "STAFF",
      permissions: ["manage:products"],
    });
    expect(perms).toContain("use:pos");
    expect(perms).toContain("manage:products");
  });

  it("ADMIN bypasses permission checks", () => {
    expect(hasPermission({ role: "ADMIN", permissions: [] }, "manage:users")).toBe(true);
  });

  it("CUSTOMER has no staff permissions", () => {
    expect(hasPermission({ role: "CUSTOMER", permissions: [] }, "manage:products")).toBe(false);
  });

  it("ORG_ADMIN includes inventory, POS, and orders", () => {
    const perms = effectivePermissions({ role: "ORG_ADMIN", permissions: [] });
    expect(perms).toContain("manage:inventory");
    expect(perms).toContain("use:pos");
    expect(perms).toContain("manage:orders");
  });

  // hasPermission/hasAnyPermission trust the passed `permissions` array as already
  // effective (it's the DB-resolved set from session/token, not raw extras) — they
  // no longer re-merge with the hardcoded role defaults, so a role edit that removes
  // a default permission actually takes effect instead of being silently restored.
  it("hasAnyPermission requires one match against the already-resolved set", () => {
    expect(
      hasAnyPermission(
        { role: "INVENTORY_MANAGER", permissions: ["manage:products", "manage:inventory"] },
        "manage:products",
        "use:pos"
      )
    ).toBe(true);
    expect(hasAnyPermission({ role: "CUSTOMER", permissions: [] }, "use:pos")).toBe(false);
  });

  it("hasPermission does not resurrect a permission removed from the resolved set", () => {
    expect(
      hasPermission({ role: "STAFF", permissions: ["manage:members"] }, "use:pos")
    ).toBe(false);
  });
});
