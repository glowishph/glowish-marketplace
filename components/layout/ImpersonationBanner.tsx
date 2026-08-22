"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface ImpersonationBannerProps {
  impersonatedName: string;
}

export function ImpersonationBanner({ impersonatedName }: ImpersonationBannerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  async function handleReturn() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/impersonate/stop", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? "Failed to end impersonation");
      }
      router.replace(body.data?.redirectTo ?? "/admin/users");
      router.refresh();
    } catch (err) {
      toast({
        title: "Couldn't return to admin",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
      setLoading(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-amber-500/15 px-4 py-2 text-amber-900 dark:text-amber-200">
      <div className="flex items-center gap-2 text-sm font-medium">
        <UserCog className="h-4 w-4 shrink-0" />
        <span>You're viewing as {impersonatedName}</span>
      </div>
      <Button size="sm" variant="outline" onClick={handleReturn} disabled={loading}>
        {loading ? "Returning…" : "Return to admin"}
      </Button>
    </div>
  );
}
