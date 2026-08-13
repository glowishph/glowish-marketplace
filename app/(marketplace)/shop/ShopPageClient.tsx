"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ElementType } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  Heart,
  ImageIcon,
  LayoutList,
  Leaf,
  Package,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { ProductRatingBadge } from "@/components/marketplace/reviews/ProductRatingBadge";
import { useProductReviewSummaries } from "@/components/marketplace/reviews/useProductReviewSummaries";
import { MarketplaceFooter } from "@/components/marketplace/MarketplaceFooter";
import {
  MARKETPLACE_PAGE_FONT,
  MARKETPLACE_PAGE_INNER,
  MARKETPLACE_PAGE_OUTER,
} from "@/lib/marketplace/pageLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormatCurrency } from "@/components/providers/TenantProvider";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useMarketplaceCartStore } from "@/store/marketplaceCartStore";
import { MARKETPLACE_CATEGORY_CARDS, marketplaceCategoryLabel } from "@/lib/marketplace/categories";
import type { MarketplaceProductSort } from "@/lib/services/marketplaceShopFilters";
import type { ProductCategory } from "@/types";

type Row = {
  _id: string;
  name: string;
  slug: string;
  sku?: string;
  images: string[];
  video?: string;
  retailPrice: number;
  category: string;
  stock: number;
};

const LIMIT = 12;
const VIEW_STORAGE_KEY = "wise-shop-view";

type ShopViewMode = "grid" | "list";

const CATS: { value: ProductCategory | ""; label: string; icon: ElementType }[] = [
  ...MARKETPLACE_CATEGORY_CARDS.map((c) => ({
    value: c.value,
    label: c.label,
    icon: c.icon,
  })),
  { value: "" as const, label: "All Products", icon: Grid3X3 },
];

type ShopFacets = {
  total: number;
  categoryCounts: Partial<Record<ProductCategory, number>>;
  priceMin: number;
  priceMax: number;
  tags: { tag: string; count: number }[];
};

function categoryLabel(value: string) {
  return marketplaceCategoryLabel(value);
}

const VALID_CATEGORIES = new Set<ProductCategory>(["homecare", "cosmetics", "wellness", "scent"]);

function parseCategoryParam(value: string | null): ProductCategory | "" {
  if (!value || !VALID_CATEGORIES.has(value as ProductCategory)) return "";
  return value as ProductCategory;
}

export function ShopPageClient() {
  const money = useFormatCurrency();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const addItem = useMarketplaceCartStore((s) => s.addItem);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState<ProductCategory | "">(() =>
    parseCategoryParam(searchParams.get("category"))
  );
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<{ total: number; hasMore: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ShopViewMode>("grid");
  const [sort, setSort] = useState<MarketplaceProductSort>("featured");
  const [facets, setFacets] = useState<ShopFacets | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [featuredHero, setFeaturedHero] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/marketplace/featured-products?placement=shop");
        const json = await res.json();
        if (cancelled || !json.success) return;
        const items: { id: string; name: string; slug: string; image: string; price: number }[] =
          json.data ?? [];
        setFeaturedHero(
          items.map((p) => ({
            _id: p.id,
            name: p.name,
            slug: p.slug,
            images: [p.image],
            retailPrice: p.price,
            category: "",
            stock: 1,
          }))
        );
      } catch {
        /* keep the existing rows-based hero fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [priceMinApplied, setPriceMinApplied] = useState<number | undefined>(undefined);
  const [priceMaxApplied, setPriceMaxApplied] = useState<number | undefined>(undefined);
  const [priceMinDraft, setPriceMinDraft] = useState("");
  const [priceMaxDraft, setPriceMaxDraft] = useState("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY);
      if (stored === "grid" || stored === "list") setViewMode(stored);
    } catch {
      /* ignore */
    }
  }, []);

  function setShopViewMode(mode: ShopViewMode) {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setCategory(parseCategoryParam(searchParams.get("category")));
    setPage(1);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/marketplace/shop/facets");
        const json = await res.json();
        if (!json.success || cancelled) return;
        const f = json.data as ShopFacets;
        setFacets(f);
        setPriceMinDraft(String(f.priceMin ?? 0));
        setPriceMaxDraft(String(f.priceMax ?? 0));
      } catch {
        /* facets optional — filters still work without counts */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: String(p),
          limit: String(LIMIT),
          search: debounced,
          category,
          sort,
        });
        if (priceMinApplied != null) params.set("minPrice", String(priceMinApplied));
        if (priceMaxApplied != null) params.set("maxPrice", String(priceMaxApplied));
        if (inStockOnly) params.set("inStock", "true");
        for (const tag of selectedTags) params.append("tag", tag);

        const res = await fetch(`/api/marketplace/products?${params}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? "Failed to load");
        setRows(json.data ?? []);
        setMeta({ total: json.meta?.total ?? 0, hasMore: !!json.meta?.hasMore });
        setPage(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [
      debounced,
      category,
      sort,
      priceMinApplied,
      priceMaxApplied,
      selectedTags,
      inStockOnly,
    ]
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const total = meta?.total ?? rows.length;
  const catalogTotal = facets?.total ?? total;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const showingStart = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const showingEnd = Math.min(page * LIMIT, total);
  const heroProducts =
    featuredHero && featuredHero.length >= 3 ? featuredHero.slice(0, 3) : rows.slice(0, 3);
  const productIds = useMemo(() => rows.map((r) => r._id), [rows]);
  const { summaries: reviewSummaries } = useProductReviewSummaries(productIds);

  const categoryCounts = facets?.categoryCounts ?? {};

  function applyPriceFilter() {
    const min = priceMinDraft.trim() === "" ? undefined : Number(priceMinDraft);
    const max = priceMaxDraft.trim() === "" ? undefined : Number(priceMaxDraft);
    if (min != null && (!Number.isFinite(min) || min < 0)) {
      toast({ title: "Invalid minimum price", variant: "destructive" });
      return;
    }
    if (max != null && (!Number.isFinite(max) || max < 0)) {
      toast({ title: "Invalid maximum price", variant: "destructive" });
      return;
    }
    if (min != null && max != null && min > max) {
      toast({ title: "Minimum price cannot exceed maximum", variant: "destructive" });
      return;
    }
    setPriceMinApplied(min);
    setPriceMaxApplied(max);
    setPage(1);
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
    setPage(1);
  }

  function clearAllFilters() {
    setSearch("");
    setCategory("");
    setSort("featured");
    setSelectedTags([]);
    setInStockOnly(false);
    setPriceMinApplied(undefined);
    setPriceMaxApplied(undefined);
    if (facets) {
      setPriceMinDraft(String(facets.priceMin));
      setPriceMaxDraft(String(facets.priceMax));
    } else {
      setPriceMinDraft("");
      setPriceMaxDraft("");
    }
    setPage(1);
  }

  function selectCategory(value: ProductCategory | "") {
    setCategory(value);
    setPage(1);
  }

  const img = (r: Row) => r.images?.[0];
  const isRemote = (url: string) => /^https?:\/\//i.test(url);

  function addProductToCart(product: Row) {
    if (product.stock <= 0) {
      toast({ title: "Out of stock", variant: "destructive" });
      return;
    }
    addItem({
      productId: product._id,
      variantId: null,
      slug: product.slug,
      name: product.name,
      sku: product.sku ?? product.slug,
      price: product.retailPrice,
      image: img(product),
      maxStock: product.stock,
      quantity: 1,
    });
    toast({ title: "Added to cart", description: product.name });
  }

  function ProductImage({ product, className }: { product: Row; className?: string }) {
    const imageUrl = img(product);
    return (
      <div className={cn("relative overflow-hidden bg-white/35", className)}>
        {imageUrl ? (
          isRemote(imageUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={product.name}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
          ) : (
            <Image
              src={imageUrl}
              alt={product.name}
              fill
              className="object-cover transition duration-500 group-hover:scale-105"
              sizes="(max-width:768px) 100vw, (max-width:1280px) 50vw, 25vw"
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-[#2A4C6A]/45">
            <Package className="h-12 w-12 opacity-40" />
          </div>
        )}
      </div>
    );
  }

  function ShopProductGridCard({ product }: { product: Row }) {
    return (
      <Card className="group overflow-hidden rounded-[10px] border-white/65 bg-white/50 shadow-[0_14px_40px_rgba(70,90,58,0.14)] backdrop-blur transition duration-200 hover:-translate-y-1 hover:bg-white/70 hover:shadow-[0_20px_55px_rgba(70,90,58,0.2)]">
        <Link href={`/product/${encodeURIComponent(product.slug)}`} className="block">
          <div className="relative aspect-square">
            <ProductImage product={product} className="aspect-square" />
            <span className="absolute right-3 top-3 rounded-full border border-white/70 bg-white/65 p-2 text-[#3c2e60] shadow-sm backdrop-blur">
              <Heart className="h-4 w-4" />
            </span>
            {product.video ? (
              <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full border border-white/70 bg-black/55 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur">
                <Video className="h-3 w-3" />
                Video
              </span>
            ) : null}
          </div>
        </Link>
        <CardContent className="space-y-2 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2A4C6A]/60">
            {categoryLabel(product.category)}
          </p>
          <Link
            href={`/product/${encodeURIComponent(product.slug)}`}
            className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-[#3c2e60] hover:text-[#2B6B56]"
          >
            {product.name}
          </Link>
          <p className="text-sm font-bold text-[#1e3157]">{money(product.retailPrice)}</p>
          <ProductRatingBadge summary={reviewSummaries[product._id]} />
          <Button
            type="button"
            className="mt-2 h-9 w-full rounded-[10px] bg-gradient-to-r from-[#6ea43f] to-[#477d34] text-xs text-white"
            disabled={product.stock <= 0}
            onClick={() => addProductToCart(product)}
          >
            {product.stock <= 0 ? "Out of Stock" : "Add to Cart"}
            <ShoppingCart className="ml-2 h-3.5 w-3.5" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  function ShopProductListRow({ product }: { product: Row }) {
    return (
      <Card className="group overflow-hidden rounded-[10px] border-white/65 bg-white/50 shadow-[0_10px_32px_rgba(70,90,58,0.12)] backdrop-blur transition duration-200 hover:bg-white/70 hover:shadow-[0_16px_44px_rgba(70,90,58,0.16)]">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
          <Link
            href={`/product/${encodeURIComponent(product.slug)}`}
            className="relative mx-auto h-28 w-28 shrink-0 overflow-hidden rounded-[10px] sm:mx-0 sm:h-32 sm:w-32"
          >
            <ProductImage product={product} className="h-full w-full rounded-[10px]" />
          </Link>
          <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2A4C6A]/60">
              {categoryLabel(product.category)}
            </p>
            <Link
              href={`/product/${encodeURIComponent(product.slug)}`}
              className="block text-base font-semibold leading-snug text-[#3c2e60] hover:text-[#2B6B56] sm:text-lg"
            >
              {product.name}
            </Link>
            <p className="text-lg font-bold text-[#1e3157]">{money(product.retailPrice)}</p>
            <div className="flex justify-center sm:justify-start">
              <ProductRatingBadge summary={reviewSummaries[product._id]} />
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:w-40">
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-[10px] border-white/70 bg-white/55 text-[#2A4C6A] sm:hidden"
              asChild
            >
              <Link href={`/product/${encodeURIComponent(product.slug)}`}>View details</Link>
            </Button>
            <Button
              type="button"
              className="h-10 rounded-[10px] bg-gradient-to-r from-[#6ea43f] to-[#477d34] text-sm text-white"
              disabled={product.stock <= 0}
              onClick={() => addProductToCart(product)}
            >
              {product.stock <= 0 ? "Out of Stock" : "Add to Cart"}
              <ShoppingCart className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className={cn(MARKETPLACE_PAGE_OUTER, MARKETPLACE_PAGE_FONT, "pt-0 pb-0")}>
      <div className="-mx-4">
        <section className="relative isolate overflow-hidden bg-white/25 px-6 py-8 shadow-[0_24px_80px_rgba(70,90,58,0.18)] backdrop-blur-xl sm:px-10 lg:min-h-[380px]">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_70%_35%,rgba(255,255,255,0.68),transparent_24%),radial-gradient(circle_at_78%_48%,rgba(0,229,255,0.16),transparent_34%)]" />
          <div className={cn(MARKETPLACE_PAGE_INNER, "grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center")}>
            <div className="max-w-md">
              <h1 className="font-[family-name:var(--font-yellowtail)] text-5xl font-normal leading-tight text-[#2B6B56] sm:text-6xl lg:text-7xl">
                Shop Our
                <span className="block font-[family-name:var(--font-yellowtail)] text-5xl font-normal text-[#F79921] sm:text-6xl lg:text-7xl">
                  Glow Essentials
                </span>
              </h1>
              <p className="mt-4 max-w-sm text-sm leading-7 text-[#2A4C6A]/85 sm:text-base">
                Premium skincare for healthy, radiant and glowing skin.
              </p>
              <Button
                className="mt-6 rounded-[10px] bg-gradient-to-r from-[#6ea43f] to-[#477d34] text-white shadow-[0_10px_30px_rgba(71,125,52,0.28)]"
                onClick={() =>
                  document.getElementById("shop-products")?.scrollIntoView({ behavior: "smooth" })
                }
              >
                Explore Products
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>

            <div className="relative hidden min-h-[300px] sm:block">
              <div className="absolute inset-x-[12%] top-[24%] h-32 rounded-full border border-white/50 bg-white/25 blur-[1px]" />
              <div className="absolute inset-x-[5%] bottom-2 h-16 rounded-[50%] bg-white/35 blur-2xl" />
              {heroProducts.map((product, index) => {
                const imageUrl = img(product);
                const positions = [
                  "left-[15%] top-[16%] h-64 w-44 rotate-[-4deg]",
                  "left-[42%] top-[16%] h-64 w-44",
                  "right-[8%] top-[16%] h-64 w-44 rotate-[5deg]",
                ];
                return (
                  <div
                    key={product._id}
                    className={`absolute ${positions[index]} overflow-hidden rounded-[10px] border border-white/70 bg-white/55 p-3 shadow-[0_20px_55px_rgba(53,68,44,0.2)] backdrop-blur`}
                  >
                    <div className="relative h-full overflow-hidden rounded-[10px] bg-white/60">
                      {imageUrl ? (
                        isRemote(imageUrl) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imageUrl} alt={product.name} className="h-full w-full object-cover" />
                        ) : (
                          <Image src={imageUrl} alt={product.name} fill className="object-cover" sizes="220px" />
                        )
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <Package className="h-12 w-12 text-[#6ea43f]" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {heroProducts.length === 0 && (
                <div className="absolute inset-8 flex items-center justify-center rounded-[10px] border border-white/70 bg-white/35">
                  <Package className="h-20 w-20 text-[#6ea43f]/50" />
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className={cn(MARKETPLACE_PAGE_INNER, "mt-6 space-y-6")}>
        <div className="flex flex-col gap-3 text-xs text-[#2A4C6A]/75 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" className="hover:text-[#2B6B56]">Home</Link>
            <span>/</span>
            <span className="font-semibold text-[#3c2e60]">Shop</span>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-[10px] border-white/70 bg-white/55 text-[#2A4C6A] lg:hidden"
              onClick={() => setFiltersOpen((o) => !o)}
            >
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              {filtersOpen ? "Hide filters" : "Filters"}
            </Button>
            <p className="text-center sm:text-right">
              Showing {showingStart}-{showingEnd} of {total} products
            </p>
            <Select
              value={sort}
              onValueChange={(v) => {
                setSort(v as MarketplaceProductSort);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-10 rounded-[10px] border-white/70 bg-white/55 text-[#2A4C6A] shadow-sm sm:w-48">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="featured">Sort by: Featured</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="price-low">Price: Low to High</SelectItem>
                <SelectItem value="price-high">Price: High to Low</SelectItem>
              </SelectContent>
            </Select>
            <div
              className="flex justify-center gap-2"
              role="group"
              aria-label="Display mode"
            >
              <Button
                type="button"
                size="icon"
                className={cn(
                  "h-10 w-10 rounded-[10px]",
                  viewMode === "grid"
                    ? "bg-[#6ea43f] text-white hover:bg-[#5f9438]"
                    : "border-white/70 bg-white/55 text-[#2A4C6A]"
                )}
                variant={viewMode === "grid" ? "default" : "outline"}
                onClick={() => setShopViewMode("grid")}
                aria-pressed={viewMode === "grid"}
                title="Grid view"
              >
                <Grid3X3 className="h-4 w-4" />
                <span className="sr-only">Grid view</span>
              </Button>
              <Button
                type="button"
                size="icon"
                className={cn(
                  "h-10 w-10 rounded-[10px]",
                  viewMode === "list"
                    ? "bg-[#6ea43f] text-white hover:bg-[#5f9438]"
                    : "border-white/70 bg-white/55 text-[#2A4C6A]"
                )}
                variant={viewMode === "list" ? "default" : "outline"}
                onClick={() => setShopViewMode("list")}
                aria-pressed={viewMode === "list"}
                title="List view"
              >
                <LayoutList className="h-4 w-4" />
                <span className="sr-only">List view</span>
              </Button>
            </div>
          </div>
        </div>

        <div id="shop-products" className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside
            className={cn(
              "space-y-5 rounded-[10px] border border-white/60 bg-white/45 p-5 shadow-[0_14px_40px_rgba(70,90,58,0.12)] backdrop-blur-xl",
              filtersOpen ? "block" : "hidden lg:block"
            )}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-[#3c2e60]">Categories</h2>
              <SlidersHorizontal className="h-4 w-4 text-[#6ea43f]" />
            </div>
            <div className="space-y-2">
              {CATS.map((cat) => (
                <button
                  key={cat.label}
                  type="button"
                  onClick={() => selectCategory(cat.value)}
                  className={`flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm transition ${
                    category === cat.value ? "bg-[#6ea43f]/15 text-[#2B6B56]" : "hover:bg-white/55"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <cat.icon className="h-4 w-4" />
                    {cat.label}
                  </span>
                  <span className="text-xs text-[#2A4C6A]/55">
                    {cat.value
                      ? categoryCounts[cat.value] ?? 0
                      : catalogTotal}
                  </span>
                </button>
              ))}
            </div>

            <div className="border-t border-[#3c2e60]/10 pt-5">
              <h3 className="mb-4 font-semibold text-[#3c2e60]">Search</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#2A4C6A]/55" />
                <Input
                  className="h-11 rounded-[10px] border-white/70 bg-white/60 pl-9 text-[#2A4C6A]"
                  placeholder="Search products..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>

            <div className="border-t border-[#3c2e60]/10 pt-5">
              <h3 className="mb-3 font-semibold text-[#3c2e60]">Price range</h3>
              {facets && facets.priceMax > facets.priceMin ? (
                <p className="mb-3 text-xs text-[#2A4C6A]/65">
                  Catalog from {money(facets.priceMin)} to {money(facets.priceMax)}
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-[#2A4C6A]/75">Min</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    className="h-10 rounded-[10px] border-white/70 bg-white/60 text-[#2A4C6A]"
                    value={priceMinDraft}
                    onChange={(e) => setPriceMinDraft(e.target.value)}
                    placeholder={facets ? String(facets.priceMin) : "0"}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[#2A4C6A]/75">Max</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    className="h-10 rounded-[10px] border-white/70 bg-white/60 text-[#2A4C6A]"
                    value={priceMaxDraft}
                    onChange={(e) => setPriceMaxDraft(e.target.value)}
                    placeholder={facets ? String(facets.priceMax) : ""}
                  />
                </div>
              </div>
              <Button
                type="button"
                className="mt-3 w-full rounded-[10px] bg-[#6ea43f]/15 text-[#2B6B56] hover:bg-[#6ea43f]/25"
                onClick={applyPriceFilter}
              >
                Apply price
              </Button>
            </div>

            {(facets?.tags.length ?? 0) > 0 ? (
              <div className="border-t border-[#3c2e60]/10 pt-5">
                <h3 className="mb-3 font-semibold text-[#3c2e60]">Tags</h3>
                <p className="mb-2 text-xs text-[#2A4C6A]/65">
                  From product tags in your catalog
                </p>
                <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                  {facets!.tags.map(({ tag, count }) => (
                    <label
                      key={tag}
                      className="flex cursor-pointer items-center justify-between gap-2 text-xs text-[#2A4C6A]/75"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Checkbox
                          className="h-3.5 w-3.5 shrink-0 border-[#2A4C6A]/25"
                          checked={selectedTags.includes(tag)}
                          onCheckedChange={() => toggleTag(tag)}
                        />
                        <span className="truncate capitalize">{tag}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-[#2A4C6A]/50">{count}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="border-t border-[#3c2e60]/10 pt-5">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[#2A4C6A]/80">
                <Checkbox
                  className="h-4 w-4 border-[#2A4C6A]/25"
                  checked={inStockOnly}
                  onCheckedChange={(checked) => {
                    setInStockOnly(checked === true);
                    setPage(1);
                  }}
                />
                In stock only
              </label>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full rounded-[10px] border-white/70 bg-white/55 text-emerald-700"
              onClick={clearAllFilters}
            >
              Clear all filters
              <Trash2 className="ml-2 h-4 w-4" />
            </Button>
          </aside>

          <main className="min-w-0">
            {error && (
              <p className="mb-4 rounded-[10px] border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            {loading && rows.length === 0 ? (
              viewMode === "grid" ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="overflow-hidden rounded-[10px] border border-white/65 bg-white/50 shadow-[0_14px_40px_rgba(70,90,58,0.14)] backdrop-blur">
                      <div className="relative aspect-square w-full">
                        <Skeleton className="absolute inset-0 rounded-none bg-white/60" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <ImageIcon className="h-10 w-10 text-[#2A4C6A]/20" />
                        </div>
                      </div>
                      <div className="space-y-3 p-4">
                        <Skeleton className="h-3 w-16 rounded-full bg-white/60" />
                        <Skeleton className="h-4 w-full rounded-[10px] bg-white/60" />
                        <Skeleton className="h-4 w-3/4 rounded-[10px] bg-white/60" />
                        <Skeleton className="h-4 w-20 rounded-[10px] bg-white/60" />
                        <Skeleton className="mt-2 h-9 w-full rounded-[10px] bg-white/60" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="overflow-hidden rounded-[10px] border border-white/65 bg-white/50 shadow-[0_10px_32px_rgba(70,90,58,0.12)] backdrop-blur">
                      <div className="flex gap-4 p-4">
                        <div className="relative h-28 w-28 shrink-0 sm:h-32 sm:w-32">
                          <Skeleton className="absolute inset-0 rounded-[10px] bg-white/60" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <ImageIcon className="h-8 w-8 text-[#2A4C6A]/20" />
                          </div>
                        </div>
                        <div className="flex flex-1 flex-col justify-between gap-2">
                          <div className="space-y-2">
                            <Skeleton className="h-3 w-20 rounded-full bg-white/60" />
                            <Skeleton className="h-5 w-2/3 rounded-[10px] bg-white/60" />
                            <Skeleton className="h-5 w-1/2 rounded-[10px] bg-white/60" />
                            <Skeleton className="h-4 w-24 rounded-[10px] bg-white/60" />
                          </div>
                          <Skeleton className="h-10 w-36 rounded-[10px] bg-white/60" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : rows.length === 0 ? (
              <div className="flex min-h-[24rem] flex-col items-center justify-center rounded-[10px] border border-dashed border-white/70 bg-white/35 py-20 text-center">
                <Package className="mb-3 h-10 w-10 text-[#2A4C6A]/45" />
                <p className="font-semibold text-[#3c2e60]">No products match your filters.</p>
                <p className="mt-1 text-sm text-[#2A4C6A]/70">Try another search or category.</p>
              </div>
            ) : (
              <>
                {viewMode === "grid" ? (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {rows.map((r) => (
                      <ShopProductGridCard key={r._id} product={r} />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {rows.map((r) => (
                      <ShopProductListRow key={r._id} product={r} />
                    ))}
                  </div>
                )}

                <div className="mt-6 flex justify-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 rounded-[10px] border-white/70 bg-white/55"
                    disabled={page <= 1 || loading}
                    onClick={() => void load(page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  {Array.from({ length: Math.min(totalPages, 3) }).map((_, i) => {
                    const n = i + 1;
                    return (
                      <Button
                        key={n}
                        variant={page === n ? "default" : "outline"}
                        className={`h-10 w-10 rounded-[10px] ${
                          page === n
                            ? "bg-[#6ea43f] text-white"
                            : "border-white/70 bg-white/55 text-[#2A4C6A]"
                        }`}
                        disabled={loading}
                        onClick={() => void load(n)}
                      >
                        {n}
                      </Button>
                    );
                  })}
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 rounded-[10px] border-white/70 bg-white/55"
                    disabled={page >= totalPages || loading}
                    onClick={() => void load(page + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </main>
        </div>
      </div>

      <div className="-mx-4 mt-10">
        <MarketplaceFooter
          showSocial
          className="rounded-none border-0 shadow-none backdrop-blur-none"
          innerClassName={MARKETPLACE_PAGE_INNER}
        />
      </div>
    </div>
  );
}
