import { Schema, model, models, type Document, type Types } from "mongoose";
import type { ProductCategory } from "@/types";

/** Singleton doc storing the current weekly-rotated banner product picks. */
export interface IFeaturedProductSelection extends Document {
  categoryFeatured: Partial<Record<ProductCategory, Types.ObjectId>>;
  homeHeroProductIds: Types.ObjectId[];
  shopHeroProductIds: Types.ObjectId[];
  selectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const categoryFeaturedSchema = new Schema(
  {
    homecare: { type: Schema.Types.ObjectId, ref: "Product", default: undefined },
    cosmetics: { type: Schema.Types.ObjectId, ref: "Product", default: undefined },
    wellness: { type: Schema.Types.ObjectId, ref: "Product", default: undefined },
    scent: { type: Schema.Types.ObjectId, ref: "Product", default: undefined },
  },
  { _id: false }
);

const FeaturedProductSelectionSchema = new Schema<IFeaturedProductSelection>(
  {
    categoryFeatured: { type: categoryFeaturedSchema, default: () => ({}) },
    homeHeroProductIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    shopHeroProductIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    selectedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

if (process.env.NODE_ENV !== "production") {
  delete (models as Record<string, unknown>).FeaturedProductSelection;
}

export const FeaturedProductSelection =
  models.FeaturedProductSelection ||
  model<IFeaturedProductSelection>("FeaturedProductSelection", FeaturedProductSelectionSchema);
