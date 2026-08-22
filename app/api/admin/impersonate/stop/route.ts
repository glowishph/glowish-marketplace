import { cookies } from "next/headers";
import { withAuth, type AuthedRequest } from "@/lib/middleware/withAuth";
import { errorResponse, notFoundResponse, successResponse } from "@/lib/utils/apiResponse";
import { writeAuditLog } from "@/lib/services/audit.service";
import {
  SESSION_MAX_AGE_SECONDS,
  encodeSessionToken,
  loadUserClaims,
  sessionCookieName,
} from "@/lib/services/impersonation.service";

const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

async function handler(req: AuthedRequest): Promise<Response> {
  const current = req.user;

  if (!current.impersonatorId) {
    return errorResponse("Not currently impersonating a user");
  }
  if (!authSecret) {
    return errorResponse("Server is missing AUTH_SECRET", 500);
  }

  const admin = await loadUserClaims(current.impersonatorId);
  if (!admin || admin.role !== "ADMIN" || !admin.isActive) {
    return notFoundResponse("Original admin account is no longer available");
  }

  const secure = req.nextUrl.protocol === "https:";
  const cookieName = sessionCookieName(secure);

  const token = await encodeSessionToken({
    secret: authSecret,
    cookieName,
    claims: admin,
    impersonatorId: null,
  });

  const store = await cookies();
  store.set(cookieName, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  void writeAuditLog({
    action: "user.impersonation_ended",
    actor: { id: admin.id, name: admin.name },
    targetId: current.id,
    targetType: "User",
    metadata: { targetEmail: current.email, targetRole: current.role },
  });

  return successResponse({ redirectTo: "/admin/users" }, "Impersonation ended");
}

export const POST = withAuth(handler);
