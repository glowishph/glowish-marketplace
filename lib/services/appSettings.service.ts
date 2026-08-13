import mongoose from "mongoose";
import { unstable_cache, revalidateTag } from "next/cache";
import { connectDB } from "@/lib/db/connect";
import { AppSettings } from "@/lib/db/models/AppSettings";
import type { PublicAppSettings } from "@/lib/types/appSettings";
import type { PatchAppSettingsInput } from "@/lib/validations/appSettings.schema";
import { imageUploadConfigured } from "@/lib/server/imageStorage";
import { maybeRemoveReplacedAppLogo } from "@/lib/services/appLogo.service";
import { maybeRemoveReplacedImpactImage } from "@/lib/services/appImpact.service";
import { writeAuditLog, type AuditActor } from "@/lib/services/audit.service";
import {
  DEFAULT_PURCHASE_ORDER_DISCOUNT_BY_ORG_TYPE,
  normalizePurchaseOrderDiscountByOrgType,
  PO_DISCOUNT_ORG_TYPES,
} from "@/lib/purchaseOrders/orgTypeDiscountDefaults";

const DEFAULTS: PublicAppSettings = {
  appName: "Glowish",
  appTagline: "POS & online store",
  appLogoUrl: "",
  seoDefaultDescription: "",
  seoOgImageUrl: "",
  currency: "PHP",
  timezone: "Asia/Manila",
  memberDefaultDiscountPercent: 10,
  defaultLowStockThreshold: 10,
  receiptFooter: "",
  purchaseOrderDiscountByOrgType: { ...DEFAULT_PURCHASE_ORDER_DISCOUNT_BY_ORG_TYPE },
  imageUploadEnabled: false,
  impactEnabled: true,
  impactImageUrl: "",
  impactTitle: "Your glow gives back",
  impactContent:
    "Every order supports the Wise Foundation. Each time you treat yourself, you help brighten someone else's day too — thank you for glowing with purpose.",
};

export function toPublicAppSettings(
  doc: {
    appName?: string;
    appTagline?: string;
    appLogoUrl?: string;
    seoDefaultDescription?: string;
    seoOgImageUrl?: string;
    currency?: string;
    timezone?: string;
    memberDefaultDiscountPercent?: number;
    defaultLowStockThreshold?: number;
    receiptFooter?: string;
    purchaseOrderDiscountByOrgType?: Partial<
      PublicAppSettings["purchaseOrderDiscountByOrgType"]
    >;
    impactEnabled?: boolean;
    impactImageUrl?: string;
    impactTitle?: string;
    impactContent?: string;
  } | null
): PublicAppSettings {
  if (!doc) return { ...DEFAULTS, imageUploadEnabled: imageUploadConfigured() };
  return {
    appName: doc.appName ?? DEFAULTS.appName,
    appTagline: doc.appTagline ?? DEFAULTS.appTagline,
    appLogoUrl: doc.appLogoUrl?.trim() ?? DEFAULTS.appLogoUrl,
    seoDefaultDescription: doc.seoDefaultDescription?.trim() ?? DEFAULTS.seoDefaultDescription,
    seoOgImageUrl: doc.seoOgImageUrl?.trim() ?? DEFAULTS.seoOgImageUrl,
    currency: doc.currency ?? DEFAULTS.currency,
    timezone: doc.timezone ?? DEFAULTS.timezone,
    memberDefaultDiscountPercent:
      doc.memberDefaultDiscountPercent ?? DEFAULTS.memberDefaultDiscountPercent,
    defaultLowStockThreshold: doc.defaultLowStockThreshold ?? DEFAULTS.defaultLowStockThreshold,
    receiptFooter: doc.receiptFooter ?? DEFAULTS.receiptFooter,
    purchaseOrderDiscountByOrgType: normalizePurchaseOrderDiscountByOrgType(
      doc.purchaseOrderDiscountByOrgType
    ),
    imageUploadEnabled: imageUploadConfigured(),
    impactEnabled: doc.impactEnabled ?? DEFAULTS.impactEnabled,
    impactImageUrl: doc.impactImageUrl?.trim() ?? DEFAULTS.impactImageUrl,
    impactTitle: doc.impactTitle ?? DEFAULTS.impactTitle,
    impactContent: doc.impactContent ?? DEFAULTS.impactContent,
  };
}

export async function getPurchaseOrderDiscountByOrgType() {
  const doc = await getAppSettingsLean();
  return normalizePurchaseOrderDiscountByOrgType(doc?.purchaseOrderDiscountByOrgType);
}

export async function getAppSettingsLean() {
  await connectDB();
  return AppSettings.findOne().lean();
}

export const getPublicAppSettings = unstable_cache(
  async (): Promise<PublicAppSettings> => {
    const doc = await getAppSettingsLean();
    return toPublicAppSettings(doc);
  },
  ["public-app-settings"],
  { tags: ["app-settings"], revalidate: 30 }
);

export async function getDefaultLowStockThreshold(): Promise<number> {
  const doc = await getAppSettingsLean();
  return doc?.defaultLowStockThreshold ?? DEFAULTS.defaultLowStockThreshold;
}

export async function getAdminAppSettingsExtras() {
  const doc = await getAppSettingsLean();
  const branchId = doc?.marketplaceFulfillmentBranchId;
  const giftProductId = doc?.spinWheelFreeGiftProductId;
  return {
    marketplaceFulfillmentBranchId: branchId ? String(branchId) : "",
    spinWheelFreeGiftProductId: giftProductId ? String(giftProductId) : "",
  };
}

export async function updateAppSettings(updates: PatchAppSettingsInput, actor?: AuditActor) {
  await connectDB();
  const existing = await AppSettings.findOne().sort({ createdAt: 1 });
  if (!existing) throw new Error("Application settings not found");

  const {
    marketplaceFulfillmentBranchId,
    spinWheelFreeGiftProductId,
    purchaseOrderDiscountByOrgType,
    ...rest
  } = updates;
  const set: Record<string, unknown> = { ...rest };

  if (rest.appLogoUrl !== undefined) {
    const next = String(rest.appLogoUrl).trim();
    const prev = existing.appLogoUrl?.trim() ?? "";
    if (prev && prev !== next) {
      await maybeRemoveReplacedAppLogo(prev);
    }
    set.appLogoUrl = next;
  }

  if (rest.seoOgImageUrl !== undefined) {
    set.seoOgImageUrl = String(rest.seoOgImageUrl).trim();
  }

  if (rest.seoDefaultDescription !== undefined) {
    set.seoDefaultDescription = String(rest.seoDefaultDescription).trim();
  }

  if (rest.impactImageUrl !== undefined) {
    const next = String(rest.impactImageUrl).trim();
    const prev = existing.impactImageUrl?.trim() ?? "";
    if (prev && prev !== next) {
      await maybeRemoveReplacedImpactImage(prev);
    }
    set.impactImageUrl = next;
  }

  if (purchaseOrderDiscountByOrgType !== undefined) {
    const normalized = normalizePurchaseOrderDiscountByOrgType(
      purchaseOrderDiscountByOrgType
    );
    for (const key of PO_DISCOUNT_ORG_TYPES) {
      set[`purchaseOrderDiscountByOrgType.${key}`] = normalized[key];
    }
  }

  if (marketplaceFulfillmentBranchId !== undefined) {
    set.marketplaceFulfillmentBranchId =
      marketplaceFulfillmentBranchId &&
      mongoose.isValidObjectId(marketplaceFulfillmentBranchId)
        ? new mongoose.Types.ObjectId(marketplaceFulfillmentBranchId)
        : null;
  }

  if (spinWheelFreeGiftProductId !== undefined) {
    set.spinWheelFreeGiftProductId =
      spinWheelFreeGiftProductId && mongoose.isValidObjectId(spinWheelFreeGiftProductId)
        ? new mongoose.Types.ObjectId(spinWheelFreeGiftProductId)
        : null;
  }

  const doc = await AppSettings.findByIdAndUpdate(
    existing._id,
    { $set: set },
    { new: true, runValidators: true }
  ).lean();
  if (!doc) throw new Error("Application settings not found");
  revalidateTag("app-settings", "seconds");

  if (actor) {
    void writeAuditLog({
      action: "settings.updated",
      actor,
      targetType: "AppSettings",
      metadata: { fields: Object.keys(updates) },
    });
  }

  return toPublicAppSettings(doc);
}
