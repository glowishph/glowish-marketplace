import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { getMaintenanceMode } from "@/lib/utils/maintenance";
import { resolveSetupRequiredForProxy } from "@/lib/utils/setupRequiredCache";
import { isCustomerOrPublicApi, isStaffBlockedRole } from "@/lib/utils/apiAccess";
import { getStaffHomePath, resolveStaffRedirectPath } from "@/lib/navigation/staffHome";
import { proxyRateLimit } from "@/lib/utils/rateLimit";

/** Reachable without auth while maintenance is on (admins can still sign in). */
const MAINTENANCE_PUBLIC = [
  "/login",
  "/setup",
  "/maintenance",
  "/api/setup",
  "/api/auth",
  "/api/maintenance",
  "/",
  "/shop",
  "/categories",
  "/cart",
  "/checkout",
  "/product",
  "/reviews",
  "/about-us",
  "/resellers",
  "/locations",
  "/contact",
  "/faqs",
  "/shipping-delivery",
  "/returns-refunds",
  "/privacy-policy",
  "/blog",
  "/marketplace",
  "/api/marketplace",
  "/account",
  "/api/account",
];

/** Reachable without session (setup wizard, auth, maintenance, public storefront). */
const UNAUTHENTICATED = [
  "/login",
  "/setup",
  "/maintenance",
  "/api/auth",
  "/api/setup",
  "/",
  "/shop",
  "/categories",
  "/cart",
  "/checkout",
  "/product",
  "/reviews",
  "/about-us",
  "/resellers",
  "/locations",
  "/contact",
  "/faqs",
  "/shipping-delivery",
  "/returns-refunds",
  "/privacy-policy",
  "/blog",
  "/marketplace",
  "/api/marketplace",
  "/account",
  "/api/account",
];

function matchesPrefixList(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isAuthApiRoute(pathname: string) {
  return pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

export async function proxy(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const res = await routeProxy(req, requestId);
  res.headers.set("X-Request-ID", requestId);
  return res;
}

async function routeProxy(req: NextRequest, requestId: string): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  const rateLimited = proxyRateLimit(req);
  if (rateLimited) return rateLimited;

  // Auth.js client expects JSON from /api/auth/* — never run setup redirects or auth() here.
  if (isAuthApiRoute(pathname)) {
    return NextResponse.next();
  }

  const maintenanceActive = await getMaintenanceMode();

  const isMaintenancePublic = matchesPrefixList(pathname, MAINTENANCE_PUBLIC);

  // If maintenance is active and NOT a public path, redirect to maintenance immediately
  if (maintenanceActive && !isMaintenancePublic) {
    // Block API calls with 503
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "System is under maintenance" },
        { status: 503 }
      );
    }

    // Redirect all pages to maintenance
    return NextResponse.redirect(new URL("/maintenance", req.url));
  }

  // During maintenance only: allow sign-in, setup, and auth API without further checks
  if (maintenanceActive && isMaintenancePublic) {
    return NextResponse.next();
  }

  // Normal operation: DB is source of truth (not app_setup cookie) so reset DB still sends users to setup.
  const bypassSetupRedirect =
    pathname === "/setup" || pathname.startsWith("/api/setup");
  if (!bypassSetupRedirect) {
    const appSetupCookieDone = req.cookies.get("app_setup")?.value === "done";
    const { required: setupRequired, checkFailed: setupCheckFailed } =
      await resolveSetupRequiredForProxy({
        timeoutMs: 4_000,
        appSetupCookieDone,
      });
    if (setupCheckFailed && matchesPrefixList(pathname, UNAUTHENTICATED)) {
      return NextResponse.next();
    }
    if (setupRequired) {
      if (pathname.startsWith("/api/") && !pathname.startsWith("/api/setup")) {
        return NextResponse.json(
          { success: false, error: "Application setup is not complete." },
          { status: 503 }
        );
      }
      const res = NextResponse.redirect(new URL("/setup", req.url));
      if (req.cookies.get("app_setup")?.value === "done") {
        res.cookies.set("app_setup", "", {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 0,
        });
      }
      return res;
    }
  }

  let session: Session | null = null;
  try {
    session = await auth();
  } catch (err) {
    console.error("[proxy] auth() failed", err);
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "Authentication service unavailable" },
        { status: 503 }
      );
    }
    if (matchesPrefixList(pathname, UNAUTHENTICATED)) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (!session?.user && matchesPrefixList(pathname, UNAUTHENTICATED)) {
    return NextResponse.next();
  }

  if (!session?.user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (
    pathname.startsWith("/api/") &&
    !isCustomerOrPublicApi(pathname) &&
    isStaffBlockedRole(session.user.role)
  ) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  if (pathname === "/login") {
    if (session.user.role === "MEMBER") {
      return NextResponse.redirect(new URL("/account", req.url));
    }
    if (!isStaffBlockedRole(session.user.role)) {
      const callbackUrl = req.nextUrl.searchParams.get("callbackUrl");
      const dest = resolveStaffRedirectPath(session.user, callbackUrl);
      return NextResponse.redirect(new URL(dest, req.url));
    }
  }

  if (pathname === "/account/login" && session.user.role !== "CUSTOMER" && session.user.role !== "MEMBER") {
    return NextResponse.redirect(new URL(getStaffHomePath(session.user), req.url));
  }

  return NextResponse.next({
    request: {
      headers: new Headers([...req.headers.entries(), ["x-request-id", requestId]]),
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
