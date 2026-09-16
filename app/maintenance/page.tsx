import { AppLogo } from "@/components/branding/AppLogo";
import { AlertTriangle } from "lucide-react";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import logger from "@/lib/logger";
import { DisableMaintenanceButton } from "@/components/maintenance/DisableMaintenanceButton";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Under Maintenance",
  description: "Our system is currently under maintenance. Please try again later.",
};

export default async function MaintenancePage() {
  let session: Session | null = null;
  try {
    session = await auth();
  } catch (err) {
    logger.error({ err }, "[maintenance page] auth failed");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 px-4">
      <div className="max-w-md w-full text-center">
        <AppLogo size="2xl" className="mx-auto mb-6" priority />
        <div className="flex justify-center mb-6">
          <div className="rounded-full bg-amber-100 p-4 dark:bg-amber-900/30">
            <AlertTriangle className="h-12 w-12 text-amber-600 dark:text-amber-500" />
          </div>
        </div>

        <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
          Under Maintenance
        </h1>

        <p className="text-lg text-slate-600 dark:text-slate-300 mb-8">
          We&apos;re currently performing system maintenance. Staff access is temporarily
          disabled while we work.
        </p>

        <div className="space-y-4 mb-8">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Thank you for your patience while we improve your experience.
          </p>
          {session?.user && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Please try again after maintenance is complete.
            </p>
          )}
        </div>

        {session?.user?.role === "ADMIN" && (
          <div className="flex justify-center mb-8">
            <DisableMaintenanceButton />
          </div>
        )}

        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            If you need immediate assistance, please contact our support team.
          </p>
        </div>
      </div>
    </div>
  );
}
