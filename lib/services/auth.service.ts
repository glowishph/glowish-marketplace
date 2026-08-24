import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { User } from "@/lib/db/models/User";
import { loadOrganizationCapabilities } from "@/lib/organization/capabilities";
import { getRolePermissions } from "@/lib/services/role.service";
import { captureSecurityEvent } from "@/lib/services/security.service";
import { verifyTotpToken } from "@/lib/services/totp.service";
import type { OrganizationType, UserRole } from "@/types";
import type { InventorySurface, PosSurface } from "@/lib/organization/capabilities";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export type LoginAudience = "staff" | "customer";

export class AccountLockedError extends Error {
  constructor(public retryAt: Date) {
    super("Account locked");
    this.name = "AccountLockedError";
  }
}

export type CredentialResult =
  | null
  | { totpRequired: true; userId: string }
  | {
      id: string;
      name: string;
      email: string;
      role: UserRole;
      branchIds: string[];
      organizationId: string | null;
      organizationType: OrganizationType | null;
      organizationCapabilities: {
        inventorySurface: InventorySurface;
        posSurface: PosSurface;
      } | null;
      permissions: string[];
      tokenVersion: number;
    };

export async function verifyCredentials(
  email: string,
  password: string,
  opts?: { audience?: LoginAudience; totpToken?: string }
): Promise<CredentialResult> {
  await connectDB();

  const audience: LoginAudience = opts?.audience ?? "staff";

  const user = await User.findOne({ email: email.toLowerCase(), deletedAt: null, isActive: true })
    .select("+password +failedLoginAttempts +lockedUntil")
    .lean();

  if (!user) return null;

  if (audience === "staff" && user.role === "CUSTOMER") return null;
  if (audience === "customer" && user.role !== "CUSTOMER" && user.role !== "MEMBER") return null;

  // Enforce lockout
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AccountLockedError(user.lockedUntil);
  }

  const isValid = await bcrypt.compare(password, user.password);

  if (!isValid) {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
    await User.updateOne(
      { _id: user._id },
      {
        failedLoginAttempts: attempts,
        ...(shouldLock ? { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) } : {}),
      }
    );
    if (shouldLock) {
      void captureSecurityEvent({
        type: "account.locked",
        userId: user._id.toString(),
        email: user.email,
        metadata: { audience, failedAttempts: attempts },
      });
    }
    return null;
  }

  // Enforce TOTP for roles that have it enabled
  if (user.totpEnabled) {
    const token = opts?.totpToken;
    if (!token) {
      // Signal to the caller that a second factor is required (no session created yet)
      return { totpRequired: true, userId: user._id.toString() };
    }
    const totpOk = await verifyTotpToken(user._id.toString(), token);
    if (!totpOk) return null;
  }

  // Successful login — clear lockout state
  await User.updateOne(
    { _id: user._id },
    { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null }
  );

  const role = user.role as UserRole;
  // user.permissions is kept authoritative by createUser/updateUser and the role
  // editor (both write the DB Role doc's permissions onto the user record). Only
  // fall back to role defaults for legacy users whose permissions were never set.
  const permissions = user.permissions?.length ? user.permissions : await getRolePermissions(role);
  const organizationId = user.organizationId?.toString() ?? null;

  let organizationType: OrganizationType | null = null;
  let organizationCapabilities: {
    inventorySurface: InventorySurface;
    posSurface: PosSurface;
  } | null = null;

  if (organizationId) {
    const caps = await loadOrganizationCapabilities(organizationId);
    if (caps) {
      organizationType = caps.type;
      organizationCapabilities = {
        inventorySurface: caps.inventorySurface,
        posSurface: caps.posSurface,
      };
    }
  }

  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role,
    branchIds: (user.branchIds as Array<{ toString(): string }> ?? []).map((b) => b.toString()),
    organizationId,
    organizationType,
    organizationCapabilities,
    permissions,
    tokenVersion: user.tokenVersion ?? 0,
  };
}

export async function getUserById(userId: string) {
  if (!mongoose.isValidObjectId(userId)) return null;
  await connectDB();
  const user = await User.findOne({ _id: userId, deletedAt: null }).lean();
  if (!user) return null;
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    branchIds: (user.branchIds as Array<{ toString(): string }> ?? []).map((b) => b.toString()),
    permissions: user.permissions,
    avatar: user.avatar,
    tokenVersion: user.tokenVersion ?? 0,
  };
}
