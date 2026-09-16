/**
 * Maintenance mode utilities
 */
import { connectDB } from "@/lib/db/connect";
import { AppSettings } from "@/lib/db/models/AppSettings";

/** Fast env-var check used as a fallback (no DB required). */
export function isMaintenanceMode(): boolean {
  return process.env.MAINTENANCE_MODE === "true";
}

export function isMaintenanceModeAdmin(): boolean {
  return false;
}

// Empty array means all roles are blocked during maintenance
export const MAINTENANCE_BYPASS_ROLES: string[] = [];

const CACHE_TTL_MS = 10_000;

let cache: { value: boolean; at: number } | null = null;
let inflight: Promise<boolean> | null = null;

async function loadMaintenanceMode(): Promise<boolean> {
  if (isMaintenanceMode()) return true;
  try {
    await connectDB();
    const doc = await AppSettings.findOne({}, { maintenanceMode: 1 }).lean();
    return doc?.maintenanceMode === true;
  } catch {
    return false;
  }
}

/**
 * DB-backed check with a short in-memory cache TTL.
 * Returns true when either the env var OR the DB flag is set.
 */
export async function getMaintenanceMode(): Promise<boolean> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  if (!inflight) {
    inflight = loadMaintenanceMode()
      .then((value) => {
        cache = { value, at: Date.now() };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function setMaintenanceMode(enabled: boolean): Promise<void> {
  await connectDB();
  await AppSettings.updateOne({}, { $set: { maintenanceMode: enabled } });
  cache = { value: enabled, at: Date.now() };
}
