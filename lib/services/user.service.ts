import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/db/connect";
import { User } from "@/lib/db/models/User";
import "@/lib/db/models/Organization"; // must be registered before populate("organizationId") runs
import { getRolePermissions } from "@/lib/services/role.service";
import { writeAuditLog, type AuditActor } from "@/lib/services/audit.service";
import type { CreateUserInput, UpdateUserInput } from "@/lib/validations/user.schema";
import { caseInsensitiveRegex } from "@/lib/utils/escapeRegex";
import { isKnownPermission } from "@/lib/roles/permissionCatalog";

/** Stable string for a user's `organizationId` ref (ObjectId or populated subdoc). */
export function userOrganizationIdString(user: { organizationId?: unknown } | null | undefined): string | null {
  if (!user) return null;
  const o = user.organizationId;
  if (o == null) return null;
  if (typeof o === "object" && "toString" in o) return (o as { toString(): string }).toString();
  return String(o);
}

/** Mongoose cannot cast "" to ObjectId; treat blank as null. */
function toOrganizationIdRef(id: string | null | undefined): string | null {
  if (id === undefined || id === null) return null;
  const t = String(id).trim();
  return t === "" ? null : t;
}

export async function getUsers(search?: string, role?: string, page = 1, limit = 20, organizationId?: string) {
  await connectDB();
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = { deletedAt: null };
  if (role) filter.role = role;
  if (organizationId) filter.organizationId = organizationId;
  if (search) {
    const rx = caseInsensitiveRegex(search);
    filter.$or = [{ name: rx }, { email: rx }];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .select("-password")
      .populate("organizationId", "name type")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  return { users, total, pages: Math.ceil(total / limit) };
}

export async function getUserById(userId: string) {
  await connectDB();
  return User.findOne({ _id: userId, deletedAt: null })
    .select("-password")
    .lean();
}

export async function createUser(data: CreateUserInput, actor?: AuditActor) {
  await connectDB();

  const existing = await User.findOne({ email: data.email.toLowerCase() });
  if (existing) throw new Error("Email is already registered");

  const hashedPassword = await bcrypt.hash(data.password, 12);
  const permissions = await getRolePermissions(data.role);

  const user = await User.create({
    name: data.name,
    email: data.email.toLowerCase(),
    password: hashedPassword,
    role: data.role,
    permissions,
    branchIds: data.branchIds,
    organizationId: toOrganizationIdRef(data.organizationId),
    phone: data.phone,
    isActive: true,
  });

  if (actor) {
    void writeAuditLog({
      action: "user.created",
      actor,
      targetId: user._id.toString(),
      targetType: "User",
      metadata: { role: data.role, email: data.email },
    });
  }

  const doc = user.toObject();
  const { password, ...safeUser } = doc;
  void password;
  return safeUser;
}

export async function updateUser(userId: string, data: UpdateUserInput, actor?: AuditActor) {
  await connectDB();

  const existing = await User.findOne({ _id: userId, deletedAt: null });
  if (!existing) throw new Error("User not found");
  if (existing.role === "ADMIN") throw new Error("The admin account cannot be modified");

  const update: Record<string, unknown> = { ...data };

  if (Object.prototype.hasOwnProperty.call(data, "organizationId")) {
    update.organizationId = toOrganizationIdRef(
      data.organizationId as string | null | undefined
    );
  }

  const roleChanged = data.role && data.role !== existing.role;
  let permissionsChanged = false;

  if (data.role) {
    // Role change wins over any submitted custom permissions — resets to the
    // new role's defaults, matching the users page's "role change resets
    // permissions" note.
    update.permissions = await getRolePermissions(data.role);
  } else if (data.permissions) {
    const unknown = data.permissions.filter((p) => !isKnownPermission(p));
    if (unknown.length) throw new Error(`Unknown permission(s): ${unknown.join(", ")}`);
    update.permissions = Array.from(new Set(data.permissions));
    permissionsChanged = true;
  }

  if (roleChanged || permissionsChanged) {
    update.$inc = { tokenVersion: 1 };
  }

  const { $inc, ...setFields } = update;
  const user = await User.findOneAndUpdate(
    { _id: userId, deletedAt: null },
    $inc ? { $set: setFields, $inc } : { $set: setFields },
    { new: true, runValidators: true }
  )
    .select("-password")
    .lean();

  if (!user) throw new Error("User not found");

  if (actor) {
    void writeAuditLog({
      action: roleChanged ? "user.role_changed" : permissionsChanged ? "user.permissions_changed" : "user.updated",
      actor,
      targetId: userId,
      targetType: "User",
      metadata: roleChanged
        ? { fromRole: existing.role, toRole: data.role }
        : permissionsChanged
          ? { permissions: update.permissions }
          : { fields: Object.keys(data) },
    });
  }

  return user;
}

export async function deleteUser(userId: string, requesterId: string, actor?: AuditActor) {
  await connectDB();

  if (userId === requesterId) throw new Error("You cannot delete your own account");

  const user = await User.findOne({ _id: userId, deletedAt: null });
  if (!user) throw new Error("User not found");
  if (user.role === "ADMIN") throw new Error("Cannot delete the admin account");

  const result = await User.findOneAndUpdate(
    { _id: userId },
    { $set: { deletedAt: new Date(), isActive: false } },
    { new: true }
  ).lean();

  if (actor) {
    void writeAuditLog({
      action: "user.deleted",
      actor,
      targetId: userId,
      targetType: "User",
      metadata: { email: user.email, role: user.role },
    });
  }

  return result;
}

/** Delete multiple users, skipping any that fail (self, admin, not found, out of scope). */
export async function bulkDeleteUsers(
  userIds: string[],
  requesterId: string,
  actor?: AuditActor,
  scopeOrganizationId?: string
) {
  const deletedIds: string[] = [];
  const failures: { id: string; reason: string }[] = [];

  for (const userId of userIds) {
    try {
      if (scopeOrganizationId) {
        const target = await User.findOne({ _id: userId, deletedAt: null }).lean();
        if (!target || userOrganizationIdString(target) !== scopeOrganizationId) {
          failures.push({ id: userId, reason: "User not found" });
          continue;
        }
      }
      await deleteUser(userId, requesterId, actor);
      deletedIds.push(userId);
    } catch (err) {
      failures.push({ id: userId, reason: err instanceof Error ? err.message : "Failed to delete" });
    }
  }

  return { deletedIds, failures };
}

/** Permanently lock or unlock a user account. */
export async function setUserLock(userId: string, lock: boolean, actor?: AuditActor) {
  await connectDB();

  const user = await User.findOne({ _id: userId, deletedAt: null });
  if (!user) throw new Error("User not found");
  if (user.role === "ADMIN") throw new Error("The admin account cannot be locked");

  const update = lock
    ? { lockedUntil: new Date("2099-01-01"), failedLoginAttempts: 0 }
    : { lockedUntil: null, failedLoginAttempts: 0 };

  await User.updateOne({ _id: userId }, { $set: update });

  if (actor) {
    void writeAuditLog({
      action: "user.locked",
      actor,
      targetId: userId,
      targetType: "User",
      metadata: { locked: lock, email: user.email },
    });
  }
}
