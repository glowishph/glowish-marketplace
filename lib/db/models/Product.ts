import { Schema, model, models, type Document } from "mongoose";
import type { ProductCategory } from "@/types";

export interface IProduct extends Document {
  name: string;
  slug: string;
  /** Brief summary for shop cards and meta description fallback (plain text). */
  shortDescription?: string;
  /** Full product description (plain text). */
  description?: string;
  /** Optional override for HTML document title / OG title. */
  seoTitle?: string;
  /** Optional override for meta description / OG description (max 320). */
  seoDescription?: string;
  category: ProductCategory;
  sku: string;
  barcode?: string;
  images: string[];
  /** Short vertical product video (texture/application/results/packaging/reaction). */
  video?: string;
  videoPosterUrl?: string;
  retailPrice: number;
  isActive: boolean;
  tags: string[];
  /** When false, product is hidden from the public marketplace catalog. */
  marketplaceListed?: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

const ProductSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    shortDescription: { type: String, maxlength: 500 },
    description: { type: String, maxlength: 20_000 },
    seoTitle: { type: String, maxlength: 150 },
    seoDescription: { type: String, maxlength: 320 },
    category: {
      type: String,
      required: true,
      enum: ["homecare", "cosmetics", "wellness", "scent"] as ProductCategory[],
    },
    sku: { type: String, required: true, unique: true, trim: true },
    barcode: { type: String },
    images: [{ type: String }],
    video: { type: String },
    videoPosterUrl: { type: String },
    retailPrice: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
    tags: [{ type: String }],
    marketplaceListed: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ProductSchema.index({ category: 1, deletedAt: 1 });
ProductSchema.index({ isActive: 1, deletedAt: 1 });
ProductSchema.index({ marketplaceListed: 1, isActive: 1, deletedAt: 1 });
ProductSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
ProductSchema.index({ name: "text", tags: "text" });

export const Product = models.Product || model<IProduct>("Product", ProductSchema);
