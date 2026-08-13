import "server-only";

/** Slug for upload directory segments (e.g. `glowish`). */
function slugifyFolderSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "glowish"
  );
}

/**
 * Root folder segment under `public/uploads/`.
 * Override with `UPLOAD_FOLDER_ROOT=glowish` in `.env.local`.
 */
export function getUploadRootFolder(): string {
  const fromEnv = process.env.UPLOAD_FOLDER_ROOT?.trim();
  if (fromEnv) return slugifyFolderSegment(fromEnv.replace(/^\/+|\/+$/g, ""));
  const appName = process.env.NEXT_PUBLIC_APP_NAME?.trim();
  if (appName) return slugifyFolderSegment(appName);
  return "glowish";
}

export function getMediaLibraryFolder(): string {
  return `${getUploadRootFolder()}/media/library`;
}

export function getProductCatalogFolder(): string {
  return `${getUploadRootFolder()}/products/catalog`;
}

export function getBrandingFolder(): string {
  return `${getUploadRootFolder()}/branding`;
}

export function getImpactFolder(): string {
  return `${getUploadRootFolder()}/impact`;
}

export function getAdsCreativeFolder(): string {
  return `${getUploadRootFolder()}/ads/creative`;
}

export function getBlogCoverFolder(): string {
  return `${getUploadRootFolder()}/blog/covers`;
}

export function getProductVideoFolder(): string {
  return `${getUploadRootFolder()}/products/video`;
}
