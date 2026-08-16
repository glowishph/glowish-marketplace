import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { connectDB } from "@/lib/db/connect";
import { Organization, type OrganizationType, type IOrganizationSettings } from "@/lib/db/models/Organization";
import { User } from "@/lib/db/models/User";
import { getRolePermissions } from "@/lib/services/role.service";
import { TYPE_DEFAULT_SETTINGS } from "@/lib/organization/typeDefaults";
import { invalidateOrgCapabilitiesCache } from "@/lib/organization/capabilities";
import { writeAuditLog, type AuditActor } from "@/lib/services/audit.service";
import type { SessionUser } from "@/types";

export { TYPE_DEFAULT_SETTINGS };

const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generateTempPassword(length = 12): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join("");
}

export async function getOrganizations(type?: OrganizationType) {
  await connectDB();
  const filter: Record<string, unknown> = { deletedAt: null };
  if (type) filter.type = type;
  return Organization.find(filter)
    .populate("parentOrganizationId", "name type")
    .sort({ name: 1 })
    .lean();
}

/** Organizations visible for B2B seller/buyer pickers (admin: all; org admin: self + parent + siblings / children). */
export async function getOrganizationsForOrderContext(user: SessionUser) {
  await connectDB();
  if (user.role === "ADMIN") {
    return Organization.find({ deletedAt: null }).select("name type settings").sort({ name: 1 }).lean();
  }
  if (user.role !== "ORG_ADMIN" || !user.organizationId) {
    return [];
  }
  const oid = user.organizationId;
  const myOrg = await Organization.findOne({ _id: oid, deletedAt: null }).select("parentOrganizationId").lean();
  const parentId = myOrg?.parentOrganizationId ? String(myOrg.parentOrganizationId) : null;

  if (parentId) {
    return Organization.find({
      deletedAt: null,
      $or: [{ _id: oid }, { _id: parentId }, { parentOrganizationId: parentId }],
    })
      .select("name type settings")
      .sort({ name: 1 })
      .lean();
  }

  return Organization.find({
    deletedAt: null,
    $or: [{ _id: oid }, { parentOrganizationId: oid }],
  })
    .select("name type settings")
    .sort({ name: 1 })
    .lean();
}

export async function getOrganizationById(id: string) {
  await connectDB();
  return Organization.findOne({ _id: id, deletedAt: null })
    .populate("parentOrganizationId", "name type")
    .lean();
}

export async function createOrganization(
  data: {
    name: string;
    type: OrganizationType;
    parentOrganizationId?: string | null;
    settings?: Partial<IOrganizationSettings>;
    contactPerson?: string;
    email?: string;
    phone?: string;
    address?: string;
    notes?: string;
  },
  actor?: AuditActor
) {
  await connectDB();

  if (data.type === "headquarters") {
    const existing = await Organization.findOne({ type: "headquarters", deletedAt: null }).lean();
    if (existing) throw new Error("A headquarters organization already exists");
  }

  if (data.email) {
    const existingUser = await User.findOne({ email: data.email.toLowerCase() }).lean();
    if (existingUser) throw new Error("Email is already registered to a user");
  }

  const settings = { ...TYPE_DEFAULT_SETTINGS[data.type], ...data.settings };
  const organization = await Organization.create({ ...data, settings });

  if (actor) {
    void writeAuditLog({
      action: "organization.created",
      actor,
      targetId: String(organization._id),
      targetType: "Organization",
      metadata: { name: data.name, type: data.type },
    });
  }

  if (!data.email) {
    return { organization, tempPassword: null };
  }

  try {
    const tempPassword = generateTempPassword();
    const permissions = await getRolePermissions("ORG_ADMIN");
    await User.create({
      name: data.contactPerson || data.name,
      email: data.email.toLowerCase(),
      password: await bcrypt.hash(tempPassword, 12),
      role: "ORG_ADMIN",
      permissions,
      organizationId: organization._id,
      phone: data.phone,
      isActive: true,
    });
    return { organization, tempPassword };
  } catch (error) {
    await Organization.deleteOne({ _id: organization._id });
    throw error;
  }
}

export async function updateOrganization(
  id: string,
  data: Partial<{
    name: string;
    type: OrganizationType;
    parentOrganizationId: string | null;
    settings: Partial<IOrganizationSettings>;
    contactPerson: string;
    email: string;
    phone: string;
    address: string;
    notes: string;
    isActive: boolean;
  }>,
  actor?: AuditActor
) {
  await connectDB();

  if (data.type === "headquarters") {
    const existingHq = await Organization.findOne({
      type: "headquarters",
      deletedAt: null,
      _id: { $ne: id },
    }).lean();
    if (existingHq) throw new Error("A headquarters organization already exists");
  }

  if (data.parentOrganizationId) {
    if (data.parentOrganizationId === id) {
      throw new Error("An organization cannot be its own parent");
    }
    // Walk up the proposed parent's ancestry to make sure it doesn't loop back to this org.
    let cursor: string | null = data.parentOrganizationId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === id) throw new Error("That parent assignment would create a circular hierarchy");
      if (visited.has(cursor)) break;
      visited.add(cursor);
      const ancestor: { parentOrganizationId?: unknown } | null = await Organization.findOne({
        _id: cursor,
        deletedAt: null,
      })
        .select("parentOrganizationId")
        .lean();
      cursor = ancestor?.parentOrganizationId ? String(ancestor.parentOrganizationId) : null;
    }
  }

  const result = await Organization.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: data },
    { new: true }
  ).lean();
  if (result) {
    invalidateOrgCapabilitiesCache(id);
    if (actor) {
      void writeAuditLog({
        action: "organization.updated",
        actor,
        targetId: id,
        targetType: "Organization",
        metadata: { fields: Object.keys(data) },
      });
    }
  }
  return result;
}

/** Generates a new temp password for the org's ORG_ADMIN user, creating one (using the org's email) if none exists yet. */
export async function resetOrgAdminPassword(organizationId: string, actor?: AuditActor) {
  await connectDB();

  const organization = await Organization.findOne({ _id: organizationId, deletedAt: null }).lean();
  if (!organization) throw new Error("Organization not found");

  const tempPassword = generateTempPassword();
  const hashedPassword = await bcrypt.hash(tempPassword, 12);

  const existingAdmin = await User.findOne({
    organizationId,
    role: "ORG_ADMIN",
    deletedAt: null,
  });

  if (existingAdmin) {
    existingAdmin.password = hashedPassword;
    existingAdmin.tokenVersion = (existingAdmin.tokenVersion ?? 0) + 1;
    await existingAdmin.save();
    if (actor) {
      void writeAuditLog({
        action: "organization.admin_password_reset",
        actor,
        targetId: organizationId,
        targetType: "Organization",
        metadata: { email: existingAdmin.email },
      });
    }
    return { email: existingAdmin.email, tempPassword };
  }

  if (!organization.email) {
    throw new Error("Organization has no email on file — add one before creating an admin account");
  }

  const conflictingUser = await User.findOne({ email: organization.email.toLowerCase() }).lean();
  if (conflictingUser) throw new Error("Organization email is already registered to a user");

  const permissions = await getRolePermissions("ORG_ADMIN");
  const user = await User.create({
    name: organization.contactPerson || organization.name,
    email: organization.email.toLowerCase(),
    password: hashedPassword,
    role: "ORG_ADMIN",
    permissions,
    organizationId: organization._id,
    phone: organization.phone,
    isActive: true,
  });

  return { email: user.email, tempPassword };
}

export async function deleteOrganization(id: string, actor?: AuditActor) {
  await connectDB();
  const organization = await Organization.findOne({ _id: id, deletedAt: null }).lean();
  invalidateOrgCapabilitiesCache(id);
  const result = await Organization.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: { deletedAt: new Date() } }
  );

  if (result && actor) {
    void writeAuditLog({
      action: "organization.deleted",
      actor,
      targetId: id,
      targetType: "Organization",
      metadata: { name: organization?.name },
    });
  }

  return result;
}
