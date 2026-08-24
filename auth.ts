import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { loginSchema } from "@/lib/validations/auth.schema";
import { AccountLockedError, verifyCredentials } from "@/lib/services/auth.service";
import { getUserById } from "@/lib/services/auth.service";

class AccountLockedSignInError extends CredentialsSignin {
  code = "AccountLocked";
}
import { loadOrganizationCapabilities } from "@/lib/organization/capabilities";
import type { UserRole } from "@/types";

declare module "next-auth" {
  interface User {
    role: UserRole;
    branchIds: string[];
    organizationId?: string | null;
    organizationType?: import("@/types").OrganizationType | null;
    organizationCapabilities?: {
      inventorySurface: import("@/lib/organization/capabilities").InventorySurface;
      posSurface: import("@/lib/organization/capabilities").PosSurface;
    } | null;
    permissions: string[];
    tokenVersion: number;
  }
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: UserRole;
      branchIds: string[];
      organizationId?: string | null;
      organizationType?: import("@/types").OrganizationType | null;
      organizationCapabilities?: {
        inventorySurface: import("@/lib/organization/capabilities").InventorySurface;
        posSurface: import("@/lib/organization/capabilities").PosSurface;
      } | null;
      permissions: string[];
      image?: string;
      impersonatorId?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
    branchIds?: string[];
    organizationId?: string | null;
    organizationType?: import("@/types").OrganizationType | null;
    organizationCapabilities?: {
      inventorySurface: import("@/lib/organization/capabilities").InventorySurface;
      posSurface: import("@/lib/organization/capabilities").PosSurface;
    } | null;
    permissions?: string[];
    tokenVersion?: number;
    invalidated?: boolean;
    impersonatorId?: string | null;
  }
}


const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

if (!authSecret && process.env.NODE_ENV === "production") {
  throw new Error(
    "AUTH_SECRET (or NEXTAUTH_SECRET) is required. Generate one with: openssl rand -hex 32"
  );
}

if (!authSecret && process.env.NODE_ENV === "development") {
  console.warn(
    "[auth] AUTH_SECRET / NEXTAUTH_SECRET is not set — session API may return errors. Add it to .env.local"
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret,
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        audience: { label: "Audience", type: "text" },
        totp: { label: "2FA Code", type: "text" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse({
          email: credentials?.email,
          password: credentials?.password,
          audience: credentials?.audience === "customer" ? "customer" : "staff",
        });
        if (!parsed.success) return null;

        let result;
        try {
          result = await verifyCredentials(parsed.data.email, parsed.data.password, {
            audience: parsed.data.audience,
            totpToken: typeof credentials?.totp === "string" && credentials.totp.trim()
              ? credentials.totp.trim()
              : undefined,
          });
        } catch (err) {
          if (err instanceof AccountLockedError) throw new AccountLockedSignInError();
          throw err;
        }

        // totpRequired: password was correct but 2FA token still needed
        if (!result || "totpRequired" in result) return null;
        return result;
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.name = user.name;
        token.email = user.email;
        token.role = user.role;
        token.branchIds = user.branchIds;
        token.organizationId = user.organizationId ?? null;
        token.organizationType = user.organizationType ?? null;
        token.organizationCapabilities = user.organizationCapabilities ?? null;
        token.permissions = user.permissions;
        token.tokenVersion = user.tokenVersion;
      } else if (token.sub) {
        // Re-check on every request: a password change bumps tokenVersion in the
        // DB, which invalidates every JWT issued before the change ("logout on
        // all devices"). A transient DB error here must not crash auth for every
        // request — fail open and keep the existing token instead.
        try {
          const fresh = await getUserById(token.sub);
          if (!fresh || fresh.tokenVersion !== token.tokenVersion) {
            token.invalidated = true;
            return token;
          }
          if (!token.role) {
            // Stale token missing fields — re-hydrate from DB
            token.name = fresh.name;
            token.email = fresh.email;
            token.role = fresh.role;
            token.branchIds = fresh.branchIds ?? [];
            token.permissions = fresh.permissions ?? [];
          }
        } catch (err) {
          console.error("[auth] jwt callback: tokenVersion re-check failed", err);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.invalidated) {
        return { ...session, user: undefined } as unknown as typeof session;
      }
      if (token && session.user) {
        const role = token.role as UserRole;
        session.user.id = token.sub!;
        session.user.name = token.name as string;
        session.user.email = token.email as string;
        session.user.role = role;
        session.user.branchIds = token.branchIds as string[];
        session.user.organizationId = (token.organizationId as string | null) ?? null;
        session.user.organizationType =
          (token.organizationType as import("@/types").OrganizationType | null) ?? null;
        const organizationId = (token.organizationId as string | null) ?? null;
        if (organizationId) {
          const caps = await loadOrganizationCapabilities(organizationId);
          if (caps) {
            session.user.organizationType = caps.type;
            session.user.organizationCapabilities = {
              inventorySurface: caps.inventorySurface,
              posSurface: caps.posSurface,
            };
          } else {
            session.user.organizationCapabilities =
              (token.organizationCapabilities as {
                inventorySurface: "branch" | "organization" | "none";
                posSurface: "branch" | "none";
              } | null) ?? null;
          }
        } else {
          session.user.organizationCapabilities = null;
          session.user.organizationType = null;
        }
        // token.permissions was already fully resolved (DB role defaults ∪ per-user
        // extras) when the token was minted — re-merging with the code defaults here
        // would resurrect anything an admin has since removed via the role editor.
        session.user.permissions = (token.permissions as string[]) ?? [];
        session.user.impersonatorId = (token.impersonatorId as string | null) ?? null;
      }
      return session;
    },
  },
});
