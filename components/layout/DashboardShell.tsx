"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Globe2, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sidebar, SIDEBAR_COLLAPSED_KEY } from "@/components/layout/Sidebar";
import type { SidebarUser } from "@/components/layout/Sidebar";
import { TenantProvider } from "@/components/providers/TenantProvider";
import type { PublicAppSettings } from "@/lib/types/appSettings";
import { AppBrand } from "@/components/branding/AppBrand";
import { ImpersonationBanner } from "@/components/layout/ImpersonationBanner";
import { cn } from "@/lib/utils";

interface DashboardShellProps {
  initialUser: SidebarUser;
  tenantSettings: PublicAppSettings;
  impersonatedName?: string | null;
  children: React.ReactNode;
}

export function DashboardShell({ initialUser, tenantSettings, impersonatedName, children }: DashboardShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (stored === "true") setSidebarCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <TenantProvider value={tenantSettings}>
      <div className="flex h-[100dvh] overflow-hidden bg-background">
      <div className="flex md:hidden fixed top-0 left-0 right-0 z-[35] min-h-20 items-center gap-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-3 py-2 sm:gap-3 sm:px-4">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <AppBrand
          theme="dashboard-mobile"
          appName={tenantSettings.appName}
          appTagline={tenantSettings.appTagline}
          className="min-w-0 flex-1"
          priority
        />
        <Button variant="outline" size="icon" className="shrink-0" asChild aria-label="View marketplace">
          <Link href="/">
            <Globe2 className="h-5 w-5" />
          </Link>
        </Button>
      </div>

      {mobileNavOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[38] bg-black/60 md:hidden"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <Sidebar
        initialUser={initialUser}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
        className={cn(
          "fixed z-[40] md:relative md:z-0 h-[100dvh] md:h-auto md:min-h-screen shrink-0",
          "transition-[transform,width] duration-200 ease-out md:translate-x-0",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
        onNavigate={() => setMobileNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden pt-20 md:pt-0">
        {impersonatedName && <ImpersonationBanner impersonatedName={impersonatedName} />}
        <div className="hidden shrink-0 items-center justify-end border-b bg-muted/25 px-4 py-2 md:flex">
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <Link href="/">
              <Globe2 className="h-4 w-4" />
              View marketplace
            </Link>
          </Button>
        </div>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch]">
          {children}
        </main>
      </div>
    </div>
    </TenantProvider>
  );
}
