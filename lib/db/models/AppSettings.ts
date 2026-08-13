import { Schema, model, models, type Document, type Types } from "mongoose";
import type { PurchaseOrderDiscountByOrgType } from "@/lib/purchaseOrders/orgTypeDiscountDefaults";

export interface IAppSettings extends Document {
  /** Branch that fulfills web marketplace orders (inventory deducted here). */
  marketplaceFulfillmentBranchId?: Types.ObjectId | null;
  /** When true, all non-admin users are redirected to /maintenance. */
  maintenanceMode: boolean;
  appName: string;
  /** Short line under the logo (e.g. tagline). */
  appTagline: string;
  /** Custom logo URL (Cloudinary or /uploads). Empty uses default /logo.png. */
  appLogoUrl: string;
  /** Default meta description for storefront SEO (max 160). */
  seoDefaultDescription: string;
  /** Default Open Graph / Twitter image URL. */
  seoOgImageUrl: string;
  currency: string;
  timezone: string;
  setupCompleted: boolean;
  /** Default member discount % when registering a new member. */
  memberDefaultDiscountPercent: number;
  /** Default low-stock alert threshold for new branch inventory rows. */
  defaultLowStockThreshold: number;
  /** Optional footer line on receipts / checkout summary. */
  receiptFooter: string;
  /** Default purchase order discount % by organization type. */
  purchaseOrderDiscountByOrgType: PurchaseOrderDiscountByOrgType;
  /** Product awarded as the "Free Perfume" spin-wheel prize. Unset = that prize is excluded. */
  spinWheelFreeGiftProductId?: Types.ObjectId | null;
  /** Shows the "impact" block (e.g. charity/foundation callout) on the storefront home page. */
  impactEnabled: boolean;
  /** Impact block image URL (Cloudinary or /uploads). Empty uses the bundled default. */
  impactImageUrl: string;
  /** Impact block heading. */
  impactTitle: string;
  /** Impact block body copy. */
  impactContent: string;
  createdAt: Date;
  updatedAt: Date;
}

const purchaseOrderDiscountByOrgTypeSchema = new Schema(
  {
    distributor: { type: Number, default: 0, min: 0, max: 100 },
    franchise: { type: Number, default: 0, min: 0, max: 100 },
    partner: { type: Number, default: 0, min: 0, max: 100 },
    headquarters: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false }
);

const AppSettingsSchema = new Schema<IAppSettings>(
  {
    marketplaceFulfillmentBranchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
    },
    appName: { type: String, required: true, default: "Glowish" },
    appTagline: { type: String, default: "POS & online store" },
    appLogoUrl: { type: String, default: "" },
    seoDefaultDescription: { type: String, default: "", maxlength: 160 },
    seoOgImageUrl: { type: String, default: "" },
    currency: { type: String, required: true, default: "PHP" },
    timezone: { type: String, required: true, default: "Asia/Manila" },
    setupCompleted: { type: Boolean, default: false },
    maintenanceMode: { type: Boolean, default: false },
    memberDefaultDiscountPercent: { type: Number, default: 10, min: 0, max: 100 },
    defaultLowStockThreshold: { type: Number, default: 10, min: 1 },
    receiptFooter: { type: String, default: "" },
    spinWheelFreeGiftProductId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    impactEnabled: { type: Boolean, default: true },
    impactImageUrl: { type: String, default: "" },
    impactTitle: { type: String, default: "Your glow gives back", maxlength: 120 },
    impactContent: {
      type: String,
      default:
        "Every order supports the Wise Foundation. Each time you treat yourself, you help brighten someone else's day too — thank you for glowing with purpose.",
      maxlength: 500,
    },
    purchaseOrderDiscountByOrgType: {
      type: purchaseOrderDiscountByOrgTypeSchema,
      default: () => ({
        distributor: 0,
        franchise: 0,
        partner: 0,
        headquarters: 0,
      }),
    },
  },
  { timestamps: true }
);

if (process.env.NODE_ENV !== "production") {
  delete (models as Record<string, unknown>).AppSettings;
}

export const AppSettings = models.AppSettings || model<IAppSettings>("AppSettings", AppSettingsSchema);
