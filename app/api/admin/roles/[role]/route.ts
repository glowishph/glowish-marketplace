import { withStaffAuth } from "@/lib/middleware/withStaffAuth";
import { withPermission } from "@/lib/middleware/withPermission";
import { updateRolePermissions } from "@/lib/services/role.service";
import { successResponse, errorResponse, serverErrorResponse } from "@/lib/utils/apiResponse";
import type { AuthedRequest } from "@/lib/middleware/withAuth";
import type { UserRole } from "@/types";

const EDITABLE_ROLES: UserRole[] = [
  "ORG_ADMIN",
  "BRANCH_MANAGER",
  "STAFF",
  "INVENTORY_MANAGER",
  "MEMBER",
  "CUSTOMER",
];

interface Ctx {
  params: Promise<{ role: string }>;
}

const patchHandler = async (req: AuthedRequest, ctx: unknown) => {
  try {
    const { role } = await (ctx as Ctx).params;
    if (!EDITABLE_ROLES.includes(role as UserRole)) {
      return errorResponse("ADMIN's permissions cannot be edited — it always has full access");
    }

    const body = await req.json();
    const permissions = Array.isArray(body?.permissions)
      ? body.permissions.filter((p: unknown): p is string => typeof p === "string")
      : null;
    if (!permissions) return errorResponse("permissions must be an array of strings");

    const result = await updateRolePermissions(role as UserRole, permissions, {
      id: req.user.id,
      name: req.user.name,
    });

    return successResponse(result, "Role permissions updated");
  } catch (error) {
    if (error instanceof Error) return errorResponse(error.message);
    return serverErrorResponse();
  }
};

export const PATCH = withStaffAuth(withPermission("manage:roles")(patchHandler));
