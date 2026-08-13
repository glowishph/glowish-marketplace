import type { PurchaseOrderDiscountByOrgType } from "@/lib/purchaseOrders/orgTypeDiscountDefaults";

/** Serializable tenant / application settings exposed to the client and API. */
export interface PublicAppSettings {
  appName: string;
  appTagline: string;
  /** Custom logo URL; empty string means use bundled default. */
  appLogoUrl: string;
  /** Default meta description for storefront pages (search / social). */
  seoDefaultDescription: string;
  /** Default Open Graph image URL; empty uses logo or bundled default. */
  seoOgImageUrl: string;
  currency: string;
  timezone: string;
  memberDefaultDiscountPercent: number;
  defaultLowStockThreshold: number;
  receiptFooter: string;
  /** Default PO discount % by organization type (configured by ADMIN). */
  purchaseOrderDiscountByOrgType: PurchaseOrderDiscountByOrgType;
  /** From server at request time; product image upload requires a writable upload directory when false. */
  imageUploadEnabled: boolean;
  /** Shows the "impact" block (e.g. charity/foundation callout) on the storefront home page. */
  impactEnabled: boolean;
  /** Impact block image URL; empty uses the bundled default. */
  impactImageUrl: string;
  /** Impact block heading. */
  impactTitle: string;
  /** Impact block body copy. */
  impactContent: string;
}

/** Admin-only fields from GET /api/settings/app */
export interface AdminAppSettings extends PublicAppSettings {
  marketplaceFulfillmentBranchId?: string;
  /** Product awarded as the "Free Perfume" spin-wheel prize. Unset = that prize is excluded. */
  spinWheelFreeGiftProductId?: string;
}
