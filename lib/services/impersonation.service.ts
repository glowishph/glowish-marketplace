import "server-only";

import { encode } from "next-auth/jwt";
import { connectDB } from "@/lib/db/connect";
import { User } from "@/lib/db/models/User";
import { effectivePermissions } from "@/lib/permissions";
import type { UserRole } from "@/types";

const IMPERSONATION_MAX_AGE_SECONDS = 60 * 60; // 1 hour
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // matches NextAuth's default

export function sessionCookieName(secure: boolean): string {
  return `${secure ? "__Secure-" : ""}authjs.session-token`;
}

export async function loadUserClaims(userId: string) {
  await connectDB();
  const user = await User.findOne({ _id: userId, deletedAt: null }).lean();
  if (!user) return null;

  const role = user.role as UserRole;
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role,
    branchIds: (user.branchIds as Array<{ toString(): string }> ?? []).map((b) => b.toString()),
    organizationId: user.organizationId?.toString() ?? null,
    permissions: effectivePermissions({ role, permissions: user.permissions }),
    tokenVersion: user.tokenVersion ?? 0,
    isActive: user.isActive,
  };
}

export async function encodeSessionToken(params: {
  secret: string;
  cookieName: string;
  claims: NonNullable<Awaited<ReturnType<typeof loadUserClaims>>>;
  impersonatorId?: string | null;
  maxAge?: number;
}): Promise<string> {
  const { secret, cookieName, claims, impersonatorId = null, maxAge = SESSION_MAX_AGE_SECONDS } = params;

  return encode({
    secret,
    salt: cookieName,
    maxAge,
    token: {
      sub: claims.id,
      name: claims.name,
      email: claims.email,
      role: claims.role,
      branchIds: claims.branchIds,
      organizationId: claims.organizationId,
      permissions: claims.permissions,
      tokenVersion: claims.tokenVersion,
      impersonatorId,
    },
  });
}

export { IMPERSONATION_MAX_AGE_SECONDS, SESSION_MAX_AGE_SECONDS };
