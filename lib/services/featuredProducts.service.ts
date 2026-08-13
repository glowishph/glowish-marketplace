import { unstable_cache, revalidateTag } from "next/cache";
import { connectDB } from "@/lib/db/connect";
import { Product } from "@/lib/db/models/Product";
import { FeaturedProductSelection } from "@/lib/db/models/FeaturedProductSelection";
import { marketplaceListedMatch } from "@/lib/services/marketplaceShopFilters";
import { writeAuditLog, type AuditActor } from "@/lib/services/audit.service";
import type { ProductCategory } from "@/types";

const CATEGORIES: ProductCategory[] = ["homecare", "cosmetics", "wellness", "scent"];

type EligibleProduct = {
  _id: unknown;
  category: ProductCategory;
};

/** Fisher-Yates shuffle; does not mutate the input. */
function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Randomly re-picks the banner products shown across the storefront and persists the selection. */
export async function refreshFeaturedProductSelection(actor?: AuditActor) {
  await connectDB();

  const eligible = await Product.find({
    ...marketplaceListedMatch,
    images: { $exists: true, $type: "array", $ne: [] },
  })
    .select("_id category")
    .lean<EligibleProduct[]>();

  const categoryFeatured: Partial<Record<ProductCategory, unknown>> = {};
  for (const category of CATEGORIES) {
    const pool = eligible.filter((p) => p.category === category);
    if (pool.length === 0) continue;
    categoryFeatured[category] = shuffled(pool)[0]!._id;
  }

  const pool = shuffled(eligible);
  const homeHeroProductIds = pool.slice(0, 3).map((p) => p._id);
  const remaining = pool.slice(3);
  const shopHeroProductIds = (remaining.length >= 3 ? remaining : shuffled(eligible))
    .slice(0, 3)
    .map((p) => p._id);

  await FeaturedProductSelection.findOneAndUpdate(
    {},
    {
      $set: {
        categoryFeatured,
        homeHeroProductIds,
        shopHeroProductIds,
        selectedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  revalidateTag("marketplace-products", "seconds");

  if (actor) {
    void writeAuditLog({
      action: "marketplace.featured_products_refreshed",
      actor,
      targetType: "FeaturedProductSelection",
      metadata: {
        categories: Object.keys(categoryFeatured),
        homeHeroCount: homeHeroProductIds.length,
        shopHeroCount: shopHeroProductIds.length,
      },
    });
  }
}

export async function getFeaturedProductSelectionLean() {
  await connectDB();
  return FeaturedProductSelection.findOne().lean();
}

export type FeaturedHeroProductSummary = {
  id: string;
  name: string;
  slug: string;
  image: string;
  price: number;
};

async function resolveHeroSummaries(ids: unknown[] | undefined): Promise<FeaturedHeroProductSummary[]> {
  if (!ids?.length) return [];
  await connectDB();
  const docs = await Product.find({
    _id: { $in: ids },
    ...marketplaceListedMatch,
    images: { $exists: true, $type: "array", $ne: [] },
  })
    .select("name slug images retailPrice")
    .lean();

  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const ordered = ids.map((id) => byId.get(String(id))).filter((d): d is NonNullable<typeof d> => !!d);

  return ordered.map((d) => ({
    id: String(d._id),
    name: d.name,
    slug: d.slug,
    image: d.images[0]!,
    price: d.retailPrice,
  }));
}

/** Cached read of the current weekly-selected hero products for a given banner placement. */
export const getFeaturedHeroProductSummaries = unstable_cache(
  async (placement: "home" | "shop"): Promise<FeaturedHeroProductSummary[]> => {
    const selection = await getFeaturedProductSelectionLean();
    if (!selection) return [];
    const ids = placement === "home" ? selection.homeHeroProductIds : selection.shopHeroProductIds;
    return resolveHeroSummaries(ids);
  },
  ["featured-hero-products"],
  { tags: ["marketplace-products"], revalidate: 60 }
);
