import type { Metadata } from "next";
import { HomePageClient } from "@/app/(marketplace)/HomePageClient";
import {
  listMarketplaceProducts,
  getMarketplaceCategoryShowcase,
  listMarketplaceAds,
} from "@/lib/services/marketplace.service";
import { getFeaturedPromo } from "@/lib/services/coupon.service";
import { getPublicAppSettings } from "@/lib/services/appSettings.service";
import { PRODUCT_CATEGORIES } from "@/lib/products/catalog";

export const metadata: Metadata = {
  title: "Glowish — Get the Glow you wish",
  description:
    "Premium beauty and wellness products crafted with natural ingredients. Shop skincare, cosmetics, home care, and health essentials — dermatologically tested and cruelty free.",
  openGraph: {
    title: "Glowish — Get the Glow you wish",
    description:
      "Premium beauty and wellness products crafted with natural ingredients. Shop skincare, cosmetics, home care, and health essentials.",
    type: "website",
  },
};

export default async function MarketplaceHomePage() {
  const [productsResult, samplesResult, adsResult, promoResult, appSettingsResult, ...categoryResults] =
    await Promise.allSettled([
      listMarketplaceProducts({ page: 1, limit: 12 }),
      getMarketplaceCategoryShowcase(),
      listMarketplaceAds(),
      getFeaturedPromo(),
      getPublicAppSettings(),
      ...PRODUCT_CATEGORIES.map((c) =>
        listMarketplaceProducts({ page: 1, limit: 3, category: c.value })
      ),
    ]);

  const products =
    productsResult.status === "fulfilled" ? (productsResult.value.data ?? []) : [];
  const meta =
    productsResult.status === "fulfilled"
      ? {
          total: productsResult.value.meta?.total ?? 0,
          hasMore: !!productsResult.value.meta?.hasMore,
        }
      : null;
  const categorySamples =
    samplesResult.status === "fulfilled" ? samplesResult.value : null;
  const ads = adsResult.status === "fulfilled" ? adsResult.value : [];
  const promo = promoResult.status === "fulfilled" ? promoResult.value : null;
  const appSettings = appSettingsResult.status === "fulfilled" ? appSettingsResult.value : null;

  const categoryProducts = Object.fromEntries(
    PRODUCT_CATEGORIES.map((c, i) => [
      c.value,
      categoryResults[i].status === "fulfilled" ? (categoryResults[i].value.data ?? []) : [],
    ])
  );

  return (
    <HomePageClient
      initialProducts={products}
      initialMeta={meta}
      initialCategorySamples={categorySamples}
      initialAds={ads}
      initialCategoryProducts={categoryProducts}
      initialPromo={promo}
      impactEnabled={appSettings?.impactEnabled ?? true}
      impactImageUrl={appSettings?.impactImageUrl}
      impactTitle={appSettings?.impactTitle}
      impactContent={appSettings?.impactContent}
    />
  );
}
