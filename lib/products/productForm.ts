import type { ProductCategory } from "@/types";

export type ProductFormValues = {
  name: string;
  shortDescription: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  category: ProductCategory | "";
  sku: string;
  barcode: string;
  retailPrice: number;
  isActive: boolean;
  marketplaceListed: boolean;
  tags: string;
  images: string[];
  video: string;
};

export const defaultProductFormValues: ProductFormValues = {
  name: "",
  shortDescription: "",
  description: "",
  seoTitle: "",
  seoDescription: "",
  category: "",
  sku: "",
  barcode: "",
  retailPrice: 0,
  isActive: true,
  marketplaceListed: false,
  tags: "",
  images: [],
  video: "",
};

export type ProductFormSource = {
  name: string;
  shortDescription?: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
  category: ProductCategory;
  sku: string;
  barcode?: string;
  retailPrice: number;
  isActive: boolean;
  marketplaceListed?: boolean;
  tags?: string[];
  images?: string[];
  video?: string;
};

export function productToFormValues(product: ProductFormSource): ProductFormValues {
  return {
    name: product.name,
    shortDescription: product.shortDescription ?? "",
    description: product.description ?? "",
    seoTitle: product.seoTitle ?? "",
    seoDescription: product.seoDescription ?? "",
    category: product.category,
    sku: product.sku,
    barcode: product.barcode ?? "",
    retailPrice: product.retailPrice,
    isActive: product.isActive,
    marketplaceListed: product.marketplaceListed !== false,
    tags: (product.tags ?? []).join(", "),
    images: product.images ?? [],
    video: product.video ?? "",
  };
}

export function buildProductSavePayload(form: ProductFormValues) {
  return {
    ...form,
    tags: form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    category: form.category || undefined,
    images: form.images,
    video: form.video || undefined,
  };
}

export type SavedProduct = {
  _id: string;
  name: string;
  sku: string;
};
