import { z } from "zod";
import { MAX_GALLERY_IMAGES } from "@/lib/constants/gallery";
import {
  PRODUCT_SEO_DESCRIPTION_MAX,
  PRODUCT_SEO_TITLE_MAX,
} from "@/lib/products/seoLimits";
import { parseImageUrl } from "@/lib/utils/imageUrl";

const imageUrlSchema = z
  .string()
  .trim()
  .refine(
    (s) => parseImageUrl(s) !== null,
    "Each image must be a valid http(s) URL or /uploads/ path"
  )
  .transform((s) => parseImageUrl(s)!);

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined));

export const createProductSchema = z.object({
  name: z.string().min(2, "Name is required").max(200),
  shortDescription: optionalText(500),
  description: optionalText(20_000),
  seoTitle: optionalText(PRODUCT_SEO_TITLE_MAX),
  seoDescription: optionalText(PRODUCT_SEO_DESCRIPTION_MAX),
  category: z.enum(["homecare", "cosmetics", "wellness", "scent"]),
  sku: z.string().min(1, "SKU is required").max(50),
  barcode: z.string().optional(),
  retailPrice: z.number().min(0, "Price must be positive"),
  isActive: z.boolean().default(true),
  marketplaceListed: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  images: z.array(imageUrlSchema).max(MAX_GALLERY_IMAGES).default([]),
  video: imageUrlSchema.optional(),
  videoPosterUrl: imageUrlSchema.optional(),
});

export const createVariantSchema = z.object({
  name: z.string().min(1, "Variant name is required"),
  sku: z.string().min(1, "SKU is required"),
  attributes: z.array(
    z.object({ key: z.string(), value: z.string() })
  ),
  retailPrice: z.number().min(0),
  images: z.array(imageUrlSchema).max(MAX_GALLERY_IMAGES).default([]),
});

export const updateProductSchema = createProductSchema.partial();
export const updateVariantSchema = createVariantSchema.partial();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreateVariantInput = z.infer<typeof createVariantSchema>;
