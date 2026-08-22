import { cookies } from "next/headers";
import { withAuth, type AuthedRequest } from "@/lib/middleware/withAuth";
import { errorResponse, forbiddenResponse, notFoundResponse, successResponse } from "@/lib/utils/apiResponse";
import { writeAuditLog } from "@/lib/services/audit.service";
import {
  IMPERSONATION_MAX_AGE_SECONDS,
  encodeSessionToken,
  loadUserClaims,
  sessionCookieName,
} from "@/lib/services/impersonation.service";

const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

async function handler(req: AuthedRequest): Promise<Response> {
  const actor = req.user;

  if (actor.role !== "ADMIN") {
    return forbiddenResponse("Only platform admins can impersonate users");
  }
  if (actor.impersonatorId) {
    return forbiddenResponse("Cannot start a new impersonation session while already impersonating");
  }
  if (!authSecret) {
    return errorResponse("Server is missing AUTH_SECRET", 500);
  }

  let targetUserId: string | undefined;
  try {
    const body = await req.json();
    targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId : undefined;
  } catch {
    return errorResponse("Invalid request body");
  }
  if (!targetUserId) return errorResponse("targetUserId is required");
  if (targetUserId === actor.id) return errorResponse("Cannot impersonate yourself");

  const target = await loadUserClaims(targetUserId);
  if (!target) return notFoundResponse("User not found");
  if (target.role === "ADMIN") return forbiddenResponse("Cannot impersonate a platform admin");
  if (!target.isActive) return errorResponse("Cannot impersonate a deactivated user");

  const secure = req.nextUrl.protocol === "https:";
  const cookieName = sessionCookieName(secure);

  const token = await encodeSessionToken({
    secret: authSecret,
    cookieName,
    claims: target,
    impersonatorId: actor.id,
    maxAge: IMPERSONATION_MAX_AGE_SECONDS,
  });

  const store = await cookies();
  store.set(cookieName, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: IMPERSONATION_MAX_AGE_SECONDS,
  });

  void writeAuditLog({
    action: "user.impersonation_started",
    actor: { id: actor.id, name: actor.name },
    targetId: target.id,
    targetType: "User",
    metadata: { targetEmail: target.email, targetRole: target.role },
  });

  return successResponse({ redirectTo: "/" }, "Impersonation started");
}

export const POST = withAuth(handler);
