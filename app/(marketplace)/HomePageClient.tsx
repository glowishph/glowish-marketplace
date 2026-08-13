"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, Package, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketplaceFooter } from "@/components/marketplace/MarketplaceFooter";
import {
  MARKETPLACE_PAGE_FONT,
  MARKETPLACE_PAGE_INNER,
  MARKETPLACE_PAGE_OUTER,
} from "@/lib/marketplace/pageLayout";
import { cn } from "@/lib/utils";
import { HomeHero } from "@/components/marketplace/home/HomeHero";
import { HomeCategoryCards } from "@/components/marketplace/home/HomeCategoryCards";
import { HomeBenefitsBand } from "@/components/marketplace/home/HomeBenefitsBand";
import { HomePromoRail } from "@/components/marketplace/home/HomePromoRail";
import {
  HomeProductCard,
  HomeSponsoredCard,
} from "@/components/marketplace/home/HomeProductCard";
import {
  scrollToSection,
  type HomeHeroSlot,
  type HomeProductRow as Row,
} from "@/components/marketplace/home/shared";
import { AdPreviewDialog } from "@/components/marketplace/ads/AdPreviewDialog";
import { PRODUCT_CATEGORIES } from "@/lib/products/catalog";
import { marketplaceCategoryLabel } from "@/lib/marketplace/categories";
import { MARKETPLACE_PRODUCT_STOCK } from "@/lib/marketplace/stockImages";
import {
  pickCategoryProductImage,
  pickHeroFloatImages,
} from "@/lib/marketplace/categoryImages";
import type { ProductCategory } from "@/types";
import type { MarketplaceAd, MarketplaceCategoryShowcase } from "@/lib/services/marketplace.service";
import type { FeaturedPromo } from "@/lib/services/coupon.service";

const PublicReviewsCarousel = dynamic(
  () =>
    import("@/components/marketplace/reviews/PublicReviewsCarousel").then(
      (m) => m.PublicReviewsCarousel
    ),
  { loading: () => <div className="h-48 animate-pulse rounded-[10px] bg-white/30" /> }
);
const AdsCarousel = dynamic(
  () => import("@/components/marketplace/ads/AdsCarousel").then((m) => m.AdsCarousel),
  { loading: () => <div className="h-48 animate-pulse rounded-[10px] bg-white/30" /> }
);

const VALID_CATEGORIES = new Set<ProductCategory>(["homecare", "cosmetics", "wellness", "scent"]);

const CATS: { value: ProductCategory | ""; label: string }[] = [
  { value: "", label: "All categories" },
  ...PRODUCT_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
];

const SPONSORED_INTERVAL = 6;

type HomePageClientProps = {
  initialProducts: Row[];
  initialMeta: { total: number; hasMore: boolean } | null;
  initialCategorySamples: MarketplaceCategoryShowcase | null;
  initialAds: MarketplaceAd[];
  initialCategoryProducts: Partial<Record<ProductCategory, Row[]>>;
  initialPromo: FeaturedPromo | null;
  impactEnabled?: boolean;
  impactImageUrl?: string | null;
  impactTitle?: string | null;
  impactContent?: string | null;
};

export function HomePageClient({
  initialProducts,
  initialMeta,
  initialCategorySamples,
  initialAds,
  initialCategoryProducts,
  initialPromo,
  impactEnabled,
  impactImageUrl,
  impactTitle,
  impactContent,
}: HomePageClientProps) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState<ProductCategory | "">("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>(initialProducts);
  const [meta, setMeta] = useState<{ total: number; hasMore: boolean } | null>(initialMeta);
  const [loading, setLoading] = useState(initialProducts.length === 0);
  const [error, setError] = useState("");
  const [previewAd, setPreviewAd] = useState<MarketplaceAd | null>(null);

  // Skip the first auto-load if the server already provided data
  const skipNextLoad = useRef(initialProducts.length > 0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (p: number, append: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: String(p),
          limit: "12",
          search: debounced,
          category,
        });
        const res = await fetch(`/api/marketplace/products?${params}`, {
          signal: controller.signal,
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? "Failed to load");
        const next: Row[] = json.data ?? [];
        const m = json.meta ?? { total: 0, hasMore: false };
        setMeta({ total: m.total ?? 0, hasMore: !!m.hasMore });
        setRows((prev) => (append ? [...prev, ...next] : next));
        setPage(p);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Error");
        if (!append) setRows([]);
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    },
    [debounced, category]
  );

  useEffect(() => {
    if (skipNextLoad.current) {
      skipNextLoad.current = false;
      return;
    }
    void load(1, false);
  }, [load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const categorySamples = initialCategorySamples;

  const heroCategoryImages = useMemo(
    () =>
      categorySamples
        ? pickHeroFloatImages(categorySamples, ["homecare", "wellness", "cosmetics"])
        : null,
    [categorySamples]
  );

  const resolveProductImage = useCallback(
    (r: Row, index: number) => {
      const direct = r.images?.[0];
      if (direct) return direct;
      const cat = VALID_CATEGORIES.has(r.category as ProductCategory)
        ? (r.category as ProductCategory)
        : null;
      if (categorySamples) return pickCategoryProductImage(categorySamples, cat);
      return MARKETPLACE_PRODUCT_STOCK[index % MARKETPLACE_PRODUCT_STOCK.length];
    },
    [categorySamples]
  );

  const categoryCardImages = useMemo(() => {
    if (!categorySamples) return null;
    const entries = [...VALID_CATEGORIES].map((cat) => [
      cat,
      pickCategoryProductImage(categorySamples, cat),
    ]);
    return Object.fromEntries(entries) as Partial<Record<ProductCategory, string>>;
  }, [categorySamples]);

  const heroSlots = useMemo<HomeHeroSlot[]>(
    () =>
      [0, 1, 2].map((index) => {
        const product = rows[index];
        const imageUrl = product
          ? resolveProductImage(product, index)
          : heroCategoryImages?.[index] ??
            MARKETPLACE_PRODUCT_STOCK[index % MARKETPLACE_PRODUCT_STOCK.length];
        return { product, imageUrl };
      }),
    [rows, resolveProductImage, heroCategoryImages]
  );

  type MergedItem = { kind: "product"; row: Row } | { kind: "sponsored"; ad: MarketplaceAd };
  const mergedRows = useMemo<MergedItem[]>(() => {
    if (initialAds.length === 0) return rows.map((row) => ({ kind: "product", row }));
    const merged: MergedItem[] = [];
    rows.forEach((row, i) => {
      merged.push({ kind: "product", row });
      if ((i + 1) % SPONSORED_INTERVAL === 0) {
        const adIndex = Math.floor(i / SPONSORED_INTERVAL) % initialAds.length;
        merged.push({ kind: "sponsored", ad: initialAds[adIndex] });
      }
    });
    return merged;
  }, [rows, initialAds]);

  function ProductCardSkeleton() {
    return (
      <div className="overflow-hidden rounded-[10px] border border-[#dde8d4] bg-white shadow-[0_2px_12px_rgba(70,90,58,0.06)]">
        <Skeleton className="aspect-[4/3] w-full rounded-none bg-[#e4eedc]" />
        <div className="space-y-3 p-4">
          <Skeleton className="h-3 w-16 rounded-[10px] bg-[#e4eedc]" />
          <Skeleton className="h-4 w-full rounded-[10px] bg-[#e4eedc]" />
          <Skeleton className="h-4 w-3/4 rounded-[10px] bg-[#e4eedc]" />
          <div className="flex items-center justify-between pt-1">
            <Skeleton className="h-6 w-20 rounded-[10px] bg-[#e4eedc]" />
            <Skeleton className="h-11 w-11 rounded-[10px] bg-[#e4eedc]" />
          </div>
        </div>
      </div>
    );
  }

  const isGroupedView = !category && !debounced;

  function selectCategory(value: ProductCategory | "") {
    setCategory((prev) => (prev === value && value !== "" ? "" : value));
    setPage(1);
    scrollToSection("featured-products");
  }

  return (
    <div className={cn(MARKETPLACE_PAGE_OUTER, MARKETPLACE_PAGE_FONT, "pt-0 pb-0")}>
      <div className="-mx-4">
        <HomeHero slots={heroSlots} totalProducts={meta?.total ?? null} />
      </div>
      <div className={cn(MARKETPLACE_PAGE_INNER, "mt-10 space-y-10")}>
      {initialAds.length > 0 && <AdsCarousel initialAds={initialAds} />}

      <HomeCategoryCards
        selected={category}
        onSelect={selectCategory}
        images={categoryCardImages}
      />

      <section id="featured-products" className="scroll-mt-24">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-[#6ea43f]">
              Featured products
            </p>
            <h2 className="mt-2 flex items-center gap-2 font-[family-name:var(--font-yellowtail)] text-3xl font-normal text-[#1f2a44]">
              Beauty favorites ready to ship
              <Sparkles className="h-5 w-5 text-[#d9a520]" aria-hidden />
            </h2>
            <p className="mt-1 text-sm text-[#64748b]">
              Live catalog from our shop — search, filter, and add to cart right here.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
              <Input
                className="h-11 rounded-[10px] border-[#d9e6cd] bg-white pl-9 text-[#2A4C6A] shadow-sm placeholder:text-[#94a3b8] focus-visible:ring-[#6ea43f]/40"
                placeholder="Search products or SKU..."
                aria-label="Search products"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Select
              value={category || "all"}
              onValueChange={(v) => selectCategory(v === "all" ? "" : (v as ProductCategory))}
            >
              <SelectTrigger
                className="h-11 w-full rounded-[10px] border-[#d9e6cd] bg-white text-[#2A4C6A] shadow-sm sm:w-[200px]"
                aria-label="Filter by category"
              >
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {CATS.map((c) => (
                  <SelectItem key={c.value || "all"} value={c.value || "all"}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="h-11 shrink-0 rounded-[10px] border-[#d9e6cd] bg-white px-4 text-[#2A4C6A] shadow-sm hover:bg-[#f4f8f0]"
              asChild
            >
              <Link href={category ? `/shop?category=${category}` : "/shop"}>
                Full shop
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {error && (
          <p
            className="mb-4 rounded-[10px] border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start xl:gap-6">
          <div>
            {isGroupedView ? (
              <div className="space-y-10">
                {PRODUCT_CATEGORIES.map((c) => {
                  const catRows = initialCategoryProducts[c.value] ?? [];
                  if (catRows.length === 0) return null;
                  return (
                    <div key={c.value}>
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-[#1f2a44]">{c.label}</h3>
                        <Link
                          href={`/shop?category=${c.value}`}
                          className="flex items-center gap-1 text-sm font-medium text-[#6ea43f] hover:underline"
                        >
                          View all
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        {catRows.map((row, index) => (
                          <HomeProductCard
                            key={row._id}
                            product={row}
                            imageUrl={resolveProductImage(row, index)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : loading && rows.length === 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <ProductCardSkeleton key={i} />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-[#c9dcbb] bg-[#f4f8f0] py-20 text-center">
                <Package className="mb-3 h-10 w-10 text-[#94a3b8]" />
                <p className="font-semibold text-[#1f2a44]">No products match your filters.</p>
                <p className="mt-1 text-sm text-[#64748b]">Try another search or category.</p>
                <Button
                  variant="outline"
                  className="mt-4 rounded-[10px] border-[#d9e6cd] bg-white shadow-sm hover:bg-[#f4f8f0]"
                  onClick={() => {
                    setSearch("");
                    setCategory("");
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              <>
                <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-[#64748b]">
                  <span>
                    {meta?.total ?? rows.length} product{(meta?.total ?? 0) === 1 ? "" : "s"}
                    {debounced || category ? " matching your filters" : ""}
                  </span>
                  {category ? (
                    <span className="rounded-[10px] border border-[#6ea43f]/30 bg-[#6ea43f]/10 px-2.5 py-0.5 text-xs font-medium text-[#477d34]">
                      {marketplaceCategoryLabel(category)}
                    </span>
                  ) : null}
                  {debounced ? (
                    <span className="rounded-[10px] border border-[#d9e6cd] bg-white px-2.5 py-0.5 text-xs text-[#2A4C6A]">
                      &ldquo;{debounced}&rdquo;
                    </span>
                  ) : null}
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {mergedRows.map((item, index) =>
                    item.kind === "sponsored" ? (
                      <HomeSponsoredCard
                        key={`ad-${item.ad.id}-${index}`}
                        ad={item.ad}
                        onPreview={setPreviewAd}
                      />
                    ) : (
                      <HomeProductCard
                        key={item.row._id}
                        product={item.row}
                        imageUrl={resolveProductImage(item.row, index)}
                      />
                    )
                  )}
                </div>
                {loading && rows.length > 0 ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <ProductCardSkeleton key={`more-${i}`} />
                    ))}
                  </div>
                ) : null}
                {meta?.hasMore && (
                  <div className="flex justify-center pt-6">
                    <Button
                      variant="outline"
                      disabled={loading}
                      onClick={() => void load(page + 1, true)}
                      className="rounded-[10px] border-[#d9e6cd] bg-white text-[#2A4C6A] shadow-sm hover:bg-[#f4f8f0]"
                    >
                      {loading ? "Loading..." : "Load more products"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
          <HomePromoRail
            imageUrl={
              categorySamples ? pickCategoryProductImage(categorySamples, "cosmetics") : null
            }
            promo={initialPromo}
            impactEnabled={impactEnabled}
            impactImageUrl={impactImageUrl}
            impactTitle={impactTitle}
            impactContent={impactContent}
          />
        </div>
      </section>

      <HomeBenefitsBand />

      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-[#6ea43f]">
              Customer feedback
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-yellowtail)] text-3xl font-normal text-[#1f2a44]">
              What our customers say
            </h2>
          </div>
          <Button
            variant="outline"
            className="rounded-[10px] border-[#d9e6cd] bg-white shadow-sm hover:bg-[#f4f8f0]"
            asChild
          >
            <Link href="/reviews">
              View all reviews
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
        <PublicReviewsCarousel limit={10} showAllLink={false} />
      </section>

      </div>
      <div className="-mx-4 mt-10">
        <MarketplaceFooter
          showSocial
          className="rounded-none border-0 shadow-none backdrop-blur-none"
          innerClassName={MARKETPLACE_PAGE_INNER}
        />
      </div>
      <AdPreviewDialog ad={previewAd} onOpenChange={(open) => !open && setPreviewAd(null)} />
    </div>
  );
}
