import { connectDB } from "@/lib/db/connect";
import { AppSettings } from "@/lib/db/models/AppSettings";
import { deleteStoredImage } from "@/lib/server/imageStorage";
import { uploadImageBlobToStorage } from "@/lib/server/imageUpload";
import { getImpactFolder } from "@/lib/server/uploadFolders";
import {
  getPublicAppSettings,
  toPublicAppSettings,
  updateAppSettings,
} from "@/lib/services/appSettings.service";
import { writeAuditLog, type AuditActor } from "@/lib/services/audit.service";
import type { PatchAppSettingsInput } from "@/lib/validations/appSettings.schema";
import {
  isCloudinaryStorageUrl,
  isStoredUploadUrl,
  parseCloudinaryPublicId,
  parseStoredUploadKey,
} from "@/lib/utils/storedImageUrl";

/** Impact-block images uploaded via Settings (not media-library picks). */
export function isDedicatedImpactImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  const folder = getImpactFolder().replace(/^\//, "");
  return trimmed.includes(`/${folder}/`) || trimmed.includes(`${folder}/`);
}

export async function maybeRemoveReplacedImpactImage(previousUrl: string | undefined | null) {
  const prev = previousUrl?.trim() ?? "";
  if (!prev || !isDedicatedImpactImageUrl(prev)) return;
  await deleteStoredImpactImageUrl(prev).catch(() => {
    /* best-effort */
  });
}

async function deleteStoredImpactImageUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) return;

  if (isCloudinaryStorageUrl(trimmed)) {
    const publicId = parseCloudinaryPublicId(trimmed);
    if (publicId) await deleteStoredImage(publicId, { url: trimmed });
    return;
  }

  if (isStoredUploadUrl(trimmed)) {
    const key = parseStoredUploadKey(trimmed);
    if (key) await deleteStoredImage(key, { url: trimmed });
  }
}

export async function uploadImpactImage(file: Blob, actor?: AuditActor) {
  await connectDB();
  const folder = getImpactFolder();
  const uploaded = await uploadImageBlobToStorage(file, folder);

  const existing = await AppSettings.findOne().sort({ createdAt: 1 }).lean();
  const previousUrl = existing?.impactImageUrl?.trim() ?? "";
  if (previousUrl && previousUrl !== uploaded.url) {
    await maybeRemoveReplacedImpactImage(previousUrl);
  }

  await updateAppSettings({ impactImageUrl: uploaded.url } as PatchAppSettingsInput);

  if (actor) {
    void writeAuditLog({ action: "settings.impact_image_updated", actor, targetType: "AppSettings" });
  }

  return getPublicAppSettings();
}

export async function removeImpactImage(actor?: AuditActor) {
  await connectDB();
  const existing = await AppSettings.findOne().sort({ createdAt: 1 }).lean();
  if (!existing) throw new Error("Application settings not found");

  await maybeRemoveReplacedImpactImage(existing.impactImageUrl);

  const doc = await AppSettings.findByIdAndUpdate(
    existing._id,
    { $set: { impactImageUrl: "" } },
    { new: true, runValidators: true }
  ).lean();
  if (!doc) throw new Error("Application settings not found");

  if (actor) {
    void writeAuditLog({ action: "settings.impact_image_removed", actor, targetType: "AppSettings" });
  }

  return toPublicAppSettings(doc);
}
