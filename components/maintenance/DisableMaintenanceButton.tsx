"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function DisableMaintenanceButton() {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);

  const handleDisable = async () => {
    setIsPending(true);
    try {
      const res = await fetch("/api/maintenance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to disable maintenance mode");
      toast({ title: "Maintenance mode disabled" });
      router.push("/settings");
      router.refresh();
    } catch (err) {
      toast({
        title: "Couldn't disable maintenance mode",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Button type="button" variant="destructive" size="sm" onClick={handleDisable} disabled={isPending}>
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
      Disable maintenance mode
    </Button>
  );
}
