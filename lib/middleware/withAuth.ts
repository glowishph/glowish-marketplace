import { auth } from "@/auth";
import { unauthorizedResponse } from "@/lib/utils/apiResponse";
import type { NextRequest } from "next/server";
import type { SessionUser } from "@/types";

export type AuthedRequest = NextRequest & { user: SessionUser };

type Handler = (req: AuthedRequest, ctx?: unknown) => Promise<Response>;

export function withAuth(handler: Handler) {
  return async (req: NextRequest, ctx?: unknown): Promise<Response> => {
    const session = await auth();
    if (!session?.user) return unauthorizedResponse();

    const authedReq = req as AuthedRequest;
    // session.user.permissions is already the fully-resolved effective set
    // (computed at login/impersonation time from the DB Role doc) — trust it as-is.
    authedReq.user = session.user as SessionUser;

    return handler(authedReq, ctx);
  };
}
