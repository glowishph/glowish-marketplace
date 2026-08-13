import { z } from "zod";
const orgTypeDiscountField = z.number().min(0).max(100);

export const purchaseOrderDiscountByOrgTypeSchema = z.object({
  distributor: orgTypeDiscountField,
  franchise: orgTypeDiscountField,
  partner: orgTypeDiscountField,
  headquarters: orgTypeDiscountField,
});

export const patchAppSettingsSchema = z.object({
  appName: z.string().min(1).max(100).optional(),
  appTagline: z.string().max(120).optional(),
  appLogoUrl: z.union([z.string().max(2048), z.literal("")]).optional(),
  seoDefaultDescription: z.string().max(160).optional(),
  seoOgImageUrl: z.union([z.string().max(2048), z.literal("")]).optional(),
  currency: z.string().min(3).max(10).optional(),
  timezone: z.string().min(1).max(64).optional(),
  memberDefaultDiscountPercent: z.number().min(0).max(100).optional(),
  defaultLowStockThreshold: z.number().int().min(1).max(999_999).optional(),
  receiptFooter: z.string().max(500).optional(),
  marketplaceFulfillmentBranchId: z
    .union([z.string().regex(/^[a-f\d]{24}$/i), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === null ? null : v)),
  spinWheelFreeGiftProductId: z
    .union([z.string().regex(/^[a-f\d]{24}$/i), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === null ? null : v)),
  purchaseOrderDiscountByOrgType: purchaseOrderDiscountByOrgTypeSchema.optional(),
  impactEnabled: z.boolean().optional(),
  impactImageUrl: z.union([z.string().max(2048), z.literal("")]).optional(),
  impactTitle: z.string().max(120).optional(),
  impactContent: z.string().max(500).optional(),
});

export type PatchAppSettingsInput = z.infer<typeof patchAppSettingsSchema>;
