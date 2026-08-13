import mongoose from "mongoose";
import type { Types } from "mongoose";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { connectDB } from "@/lib/db/connect";
import { AppSettings } from "@/lib/db/models/AppSettings";
import { Branch } from "@/lib/db/models/Branch";
import { Inventory } from "@/lib/db/models/Inventory";
import { Order } from "@/lib/db/models/Order";
import { OrderItem } from "@/lib/db/models/OrderItem";
import { Product } from "@/lib/db/models/Product";
import { ProductVariant } from "@/lib/db/models/ProductVariant";
import { Ad } from "@/lib/db/models/Ad";
import { BlogPost, type IBlogPost } from "@/lib/db/models/BlogPost";
import { StockMovement } from "@/lib/db/models/StockMovement";
import { Transaction } from "@/lib/db/models/Transaction";
import { User } from "@/lib/db/models/User";
import { MarketplaceContactMessage } from "@/lib/db/models/MarketplaceContactMessage";
import { generateOrderNumber, formatCurrency } from "@/lib/utils";
import type { MarketplaceCheckoutInput } from "@/lib/validations/marketplace.schema";
import { markAbandonedCheckoutRecovered } from "@/lib/services/abandonedCheckout.service";
import type { ProductCategory } from "@/types";
import {
  buildMarketplaceProductFilter,
  marketplaceListedMatch,
  marketplaceProductSortSpec,
  normalizeShopTags,
  type MarketplaceShopListParams,
} from "@/lib/services/marketplaceShopFilters";
import { getFeaturedProductSelectionLean } from "@/lib/services/featuredProducts.service";
import { getCustomerDashboard } from "@/lib/services/customerDashboard.service";
import { validateCoupon, redeemCoupon } from "@/lib/services/coupon.service";
import {
  addCustomerPaymentMethod,
  addCustomerSavedAddress,
  getCustomerPaymentMethods,
} from "@/lib/services/customerAccountData.service";
import {
  cardBrandLabel,
  isValidExpiry,
  type CardBrand,
  type ResolvedMarketplaceCardPayment,
} from "@/lib/utils/cardPayment";
import {
  maskPhilippineMobile,
  normalizePhilippineMobile,
  type ResolvedMarketplaceGcashPayment,
} from "@/lib/utils/gcashPayment";
import {
  validateBankTransferEntry,
  type ResolvedMarketplaceBankTransferPayment,
} from "@/lib/utils/bankTransferPayment";
import { MARKETPLACE_COD_MIN_ORDER } from "@/lib/constants/marketplaceCod";
import {
  validateCodEntry,
  type ResolvedMarketplaceCodPayment,
} from "@/lib/utils/codPayment";
import {
  computeCheckoutShippingCost,
  computeMarketplaceOrderTotal,
  isMarketplacePaymentCaptured,
  marketplaceOrderStatusForPayment,
} from "@/lib/utils/marketplaceShipping";
import { isPaymongoConfigured, phpAmountToCentavos } from "@/lib/paymongo/config";
import { verifyMarketplacePaymongoPayment } from "@/lib/services/paymongoCheckout.service";
import { quoteMarketplaceCheckout } from "@/lib/services/marketplaceCheckoutQuote.service";

function inferBrandFromPaymentLabel(label: string): CardBrand {
  const lower = label.toLowerCase();
  if (lower.includes("visa")) return "visa";
  if (lower.includes("master")) return "mastercard";
  if (lower.includes("amex") || lower.includes("american express")) return "amex";
  return "unknown";
}

export async function resolveMarketplaceCardPayment(
  customerUserId: string | null,
  input: MarketplaceCheckoutInput
): Promise<ResolvedMarketplaceCardPayment> {
  if (input.paymentMethod !== "card") {
    throw new Error("Card payment required");
  }

  if (input.savedPaymentMethodId) {
    if (!customerUserId) throw new Error("Sign in to use a saved card");
    const methods = await getCustomerPaymentMethods(customerUserId);
    const method = methods.find((m) => m.id === input.savedPaymentMethodId);
    if (!method || method.type !== "card") throw new Error("Saved card not found");
    if (!method.last4) throw new Error("Saved card is missing card details");
    return {
      cardBrand: inferBrandFromPaymentLabel(method.label),
      cardLast4: method.last4,
      cardholderName: method.label,
      savedMethodId: method.id,
    };
  }

  const cp = input.cardPayment;
  if (!cp) throw new Error("Enter card details to pay by card");

  if (!isValidExpiry(cp.expMonth, cp.expYear)) {
    throw new Error("Card has expired or expiry date is invalid");
  }

  return {
    cardBrand: cp.cardBrand,
    cardLast4: cp.cardLast4,
    cardholderName: cp.cardholderName,
    expMonth: cp.expMonth,
    expYear: cp.expYear,
  };
}

export async function resolveMarketplaceGcashPayment(
  customerUserId: string | null,
  input: MarketplaceCheckoutInput
): Promise<ResolvedMarketplaceGcashPayment> {
  if (input.paymentMethod !== "gcash") {
    throw new Error("GCash payment required");
  }

  if (input.savedPaymentMethodId) {
    if (!customerUserId) throw new Error("Sign in to use a saved GCash account");
    const methods = await getCustomerPaymentMethods(customerUserId);
    const method = methods.find((m) => m.id === input.savedPaymentMethodId);
    if (!method || method.type !== "gcash") throw new Error("Saved GCash account not found");
    if (!method.last4) throw new Error("Saved GCash account is missing mobile details");
    return {
      accountName: method.label,
      mobileLast4: method.last4,
      mobileMasked: `GCash •••• ${method.last4}`,
      savedMethodId: method.id,
    };
  }

  const gp = input.gcashPayment;
  if (!gp) throw new Error("Enter your GCash mobile number");

  const normalized = normalizePhilippineMobile(gp.mobileNumber);
  if (!normalized) throw new Error("Enter a valid Philippine mobile number (09XX XXX XXXX)");

  return {
    accountName: gp.accountName,
    mobileLast4: normalized.slice(-4),
    mobileMasked: maskPhilippineMobile(normalized),
  };
}

export async function resolveMarketplaceBankTransferPayment(
  customerUserId: string | null,
  input: MarketplaceCheckoutInput
): Promise<ResolvedMarketplaceBankTransferPayment> {
  if (input.paymentMethod !== "bank_transfer") {
    throw new Error("Bank transfer payment required");
  }

  const bt = input.bankTransferPayment;
  if (!bt) throw new Error("Enter bank transfer details");

  let depositorName = bt.depositorName?.trim() ?? "";
  let depositorBank = bt.depositorBank?.trim() ?? "";
  let accountLast4 = bt.accountLast4;

  if (input.savedPaymentMethodId) {
    if (!customerUserId) throw new Error("Sign in to use a saved bank account");
    const methods = await getCustomerPaymentMethods(customerUserId);
    const method = methods.find((m) => m.id === input.savedPaymentMethodId);
    if (!method || method.type !== "bank_transfer") {
      throw new Error("Saved bank account not found");
    }
    depositorName = depositorName || method.label;
    if (!depositorBank) depositorBank = "Saved account";
    accountLast4 = accountLast4 ?? method.last4;
  }

  const validated = validateBankTransferEntry({
    depositorName,
    depositorBank,
    accountLast4: accountLast4 ?? "",
    transferReference: bt.transferReference,
    depositToBankId: bt.depositToBankId,
  });

  if (!validated.ok) throw new Error(validated.error);

  if (input.savedPaymentMethodId) {
    return { ...validated.resolved, savedMethodId: input.savedPaymentMethodId };
  }

  return validated.resolved;
}

export async function resolveMarketplaceCodPayment(
  input: MarketplaceCheckoutInput,
  amountDue: number,
  currency = "PHP"
): Promise<ResolvedMarketplaceCodPayment> {
  if (input.paymentMethod !== "cash") {
    throw new Error("Cash on delivery payment required");
  }

  const cp = input.codPayment;
  if (!cp?.codAcknowledged) {
    throw new Error("Confirm cash on delivery terms to continue");
  }

  const validated = validateCodEntry({
    acknowledged: true,
    amountDue,
    prepareChangeFor: cp.prepareChangeFor,
    minOrderAmount: MARKETPLACE_COD_MIN_ORDER,
    currency,
  });

  if (!validated.ok) throw new Error(validated.error);
  return validated.resolved;
}

const listedFilter: Record<string, unknown> = { ...marketplaceListedMatch };

export async function listMarketplaceProductSlugs(): Promise<
  { slug: string; updatedAt?: Date }[]
> {
  await connectDB();
  const rows = await Product.find(listedFilter)
    .select("slug updatedAt")
    .sort({ updatedAt: -1 })
    .lean();
  return rows.map((row) => ({
    slug: row.slug,
    updatedAt: row.updatedAt,
  }));
}

export const getMarketplaceFulfillmentContext = cache(async (): Promise<{
  branchId: Types.ObjectId;
  organizationId: Types.ObjectId | null;
}> => {
  await connectDB();
  const settings = await AppSettings.findOne().sort({ _id: 1 }).lean();
  let branchId = settings?.marketplaceFulfillmentBranchId;
  let branch = branchId ? await Branch.findById(branchId).lean() : null;

  if (!branch) {
    const hq = await Branch.findOne({ isHeadOffice: true, deletedAt: null, isActive: true }).lean();
    branch =
      hq ?? (await Branch.findOne({ deletedAt: null, isActive: true }).sort({ _id: 1 }).lean());
    if (!branch) {
      throw new Error(
        "No branch is available to fulfill online orders. Create a branch in Admin first."
      );
    }
  }
  return {
    branchId: branch._id as Types.ObjectId,
    organizationId: (branch.organizationId as Types.ObjectId | null | undefined) ?? null,
  };
});

export async function resolveMarketplaceCashierId(): Promise<Types.ObjectId> {
  await connectDB();
  const admin = await User.findOne({ role: "ADMIN", deletedAt: null, isActive: true })
    .sort({ _id: 1 })
    .lean();
  if (!admin?._id) throw new Error("No administrator account found for marketplace orders");
  return admin._id as Types.ObjectId;
}

export type CategoryFeaturedProduct = {
  productId: string;
  name: string;
  slug: string;
  image: string;
};

export type MarketplaceCategoryShowcase = {
  /** Newest listed product with an image in each category. */
  featured: Partial<Record<ProductCategory, CategoryFeaturedProduct>>;
  catalog: CategoryFeaturedProduct | null;
};

export type MarketplaceCategorySampleImages = {
  byCategory: Partial<Record<ProductCategory, string>>;
  featured: Partial<Record<ProductCategory, CategoryFeaturedProduct>>;
  catalog: string | null;
  catalogProduct: CategoryFeaturedProduct | null;
};

const _cachedCategoryShowcase = unstable_cache(
  async (): Promise<MarketplaceCategoryShowcase> => {
  await connectDB();

  const grouped = await Product.aggregate<{
    _id: ProductCategory;
    productId: mongoose.Types.ObjectId;
    name: string;
    slug: string;
    image: string;
  }>([
    {
      $match: {
        ...marketplaceListedMatch,
        images: { $exists: true, $type: "array", $ne: [] },
      },
    },
    { $sort: { updatedAt: -1 } },
    {
      $group: {
        _id: "$category",
        productId: { $first: "$_id" },
        name: { $first: "$name" },
        slug: { $first: "$slug" },
        image: { $first: { $arrayElemAt: ["$images", 0] } },
      },
    },
  ]);

  const featured: Partial<Record<ProductCategory, CategoryFeaturedProduct>> = {};
  for (const row of grouped) {
    if (!row._id || !row.image) continue;
    featured[row._id] = {
      productId: String(row.productId),
      name: row.name,
      slug: row.slug,
      image: row.image,
    };
  }

  const selection = await getFeaturedProductSelectionLean();
  const overrideIds = selection
    ? Object.values(selection.categoryFeatured ?? {}).filter(Boolean)
    : [];
  if (overrideIds.length > 0) {
    const overrideDocs = await Product.find({
      _id: { $in: overrideIds },
      ...marketplaceListedMatch,
      images: { $exists: true, $type: "array", $ne: [] },
    })
      .select("name slug images")
      .lean();
    const overrideById = new Map(overrideDocs.map((d) => [String(d._id), d]));
    for (const category of Object.keys(selection!.categoryFeatured ?? {}) as ProductCategory[]) {
      const productId = selection!.categoryFeatured?.[category];
      const doc = productId ? overrideById.get(String(productId)) : undefined;
      if (doc?.images?.[0]) {
        featured[category] = {
          productId: String(doc._id),
          name: doc.name as string,
          slug: doc.slug as string,
          image: doc.images[0] as string,
        };
      }
    }
  }

  const catalogDoc = await Product.findOne({
    ...marketplaceListedMatch,
    images: { $exists: true, $type: "array", $ne: [] },
  })
    .select("name slug images")
    .sort({ updatedAt: -1 })
    .lean();

  const catalog = catalogDoc?.images?.[0]
    ? {
        productId: String(catalogDoc._id),
        name: catalogDoc.name as string,
        slug: catalogDoc.slug as string,
        image: catalogDoc.images[0] as string,
      }
    : featured.wellness ??
      featured.cosmetics ??
      featured.homecare ??
      featured.scent ??
      null;

  return { featured, catalog };
  },
  ["marketplace-category-showcase"],
  { revalidate: 120, tags: ["marketplace-products"] }
);

export async function getMarketplaceCategoryShowcase(): Promise<MarketplaceCategoryShowcase> {
  return _cachedCategoryShowcase();
}

export async function getMarketplaceCategorySampleImages(): Promise<MarketplaceCategorySampleImages> {
  const { featured, catalog } = await getMarketplaceCategoryShowcase();
  const byCategory: Partial<Record<ProductCategory, string>> = {};
  for (const [key, product] of Object.entries(featured) as [
    ProductCategory,
    CategoryFeaturedProduct,
  ][]) {
    byCategory[key] = product.image;
  }
  return {
    byCategory,
    featured,
    catalog: catalog?.image ?? null,
    catalogProduct: catalog,
  };
}

const _cachedShopFacets = unstable_cache(
  async () => {
  await connectDB();
  const [facet] = await Product.aggregate<{
    total: { n: number }[];
    categories: { _id: ProductCategory; count: number }[];
    price: { min: number; max: number }[];
    tags: { _id: string; count: number }[];
  }>([
    { $match: marketplaceListedMatch },
    {
      $facet: {
        total: [{ $count: "n" }],
        categories: [{ $group: { _id: "$category", count: { $sum: 1 } } }],
        price: [
          {
            $group: {
              _id: null,
              min: { $min: "$retailPrice" },
              max: { $max: "$retailPrice" },
            },
          },
        ],
        tags: [
          { $unwind: { path: "$tags", preserveNullAndEmptyArrays: false } },
          { $match: { tags: { $type: "string", $ne: "" } } },
          { $group: { _id: { $toLower: "$tags" }, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 32 },
        ],
      },
    },
  ]);

  const categoryCounts: Partial<Record<ProductCategory, number>> = {};
  for (const row of facet?.categories ?? []) {
    if (row._id) categoryCounts[row._id] = row.count;
  }

  const priceRow = facet?.price?.[0];
  const priceMin = priceRow?.min ?? 0;
  const priceMax = priceRow?.max ?? 0;

  return {
    total: facet?.total?.[0]?.n ?? 0,
    categoryCounts,
    priceMin,
    priceMax,
    tags: (facet?.tags ?? []).map((t) => ({
      tag: t._id,
      count: t.count,
    })),
  };
  },
  ["marketplace-shop-facets"],
  { revalidate: 120, tags: ["marketplace-products"] }
);

export async function getMarketplaceShopFacets() {
  return _cachedShopFacets();
}

const _cachedListMarketplaceProducts = unstable_cache(
  async (branchIdStr: string, params: MarketplaceShopListParams) => {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(branchIdStr)) {
      throw new Error(`Invalid fulfillment branch ID: "${branchIdStr}"`);
    }
    const branchId = new mongoose.Types.ObjectId(branchIdStr);
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(48, Math.max(1, params.limit ?? 12));
    const skip = (page - 1) * limit;
    const tags = normalizeShopTags(params.tags);
    const sortKey = params.sort ?? "featured";

    let filter = buildMarketplaceProductFilter({
      category: params.category,
      search: params.search,
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
      tags,
    });

    if (params.inStockOnly) {
      const stocked = await Inventory.aggregate<{ _id: Types.ObjectId }>([
        { $match: { branchId, quantity: { $gt: 0 } } },
        { $group: { _id: "$productId" } },
      ]);
      const ids = stocked.map((r) => r._id);
      filter = { $and: [filter, { _id: { $in: ids.length ? ids : [new mongoose.Types.ObjectId()] } }] };
    }

    const sort = marketplaceProductSortSpec(sortKey);

    const [rows, total] = await Promise.all([
      Product.find(filter)
        .select(
          "name slug images video retailPrice category sku shortDescription description seoTitle seoDescription tags"
        )
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);

    const ids = rows.map((r) => r._id);
    const inv =
      ids.length === 0
        ? []
        : await Inventory.find({ branchId, productId: { $in: ids } }).lean();
    const stockByProduct = new Map<string, number>();
    for (const row of inv) {
      const pid = row.productId.toString();
      stockByProduct.set(pid, (stockByProduct.get(pid) ?? 0) + row.quantity);
    }

    return {
      data: rows.map((p) => ({
        _id: p._id.toString(),
        name: p.name,
        slug: p.slug,
        images: p.images ?? [],
        video: p.video,
        retailPrice: p.retailPrice,
        category: p.category,
        sku: p.sku,
        shortDescription: p.shortDescription,
        description: p.description,
        tags: p.tags ?? [],
        stock: stockByProduct.get(p._id.toString()) ?? 0,
      })),
      meta: { page, limit, total, hasMore: skip + rows.length < total, sort: sortKey },
    };
  },
  ["marketplace-products-list"],
  { revalidate: 60, tags: ["marketplace-products"] }
);

export async function listMarketplaceProducts(params: MarketplaceShopListParams) {
  await connectDB();
  const { branchId } = await getMarketplaceFulfillmentContext();
  return _cachedListMarketplaceProducts(branchId.toString(), params);
}

export type MarketplaceAd = {
  id: string;
  creativeType: "image" | "video";
  creativeUrl: string;
  posterUrl?: string;
  headline?: string;
  caption?: string;
  product: { id: string; name: string; slug: string; image: string | null; price: number };
};

export async function listMarketplaceAds(limit = 8): Promise<MarketplaceAd[]> {
  await connectDB();
  const now = new Date();
  const ads = await Ad.find({
    isActive: true,
    deletedAt: null,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  })
    .sort({ sortOrder: 1, createdAt: -1 })
    .limit(limit)
    .populate({ path: "productId", match: marketplaceListedMatch, select: "name slug images retailPrice" })
    .lean();

  return ads
    .filter((ad) => ad.productId)
    .map((ad) => {
      const product = ad.productId as unknown as {
        _id: unknown;
        name: string;
        slug: string;
        images?: string[];
        retailPrice: number;
      };
      return {
        id: String(ad._id),
        creativeType: ad.creativeType,
        creativeUrl: ad.creativeUrl,
        posterUrl: ad.posterUrl,
        headline: ad.headline,
        caption: ad.caption,
        product: {
          id: String(product._id),
          name: product.name,
          slug: product.slug,
          image: product.images?.[0] ?? null,
          price: product.retailPrice,
        },
      };
    });
}

export async function listPublishedBlogPosts(): Promise<IBlogPost[]> {
  await connectDB();
  const posts = await BlogPost.find({ isPublished: true, deletedAt: null })
    .sort({ publishedAt: -1 })
    .lean();
  return posts as unknown as IBlogPost[];
}

export async function getPublishedBlogPostBySlug(slug: string): Promise<IBlogPost | null> {
  await connectDB();
  const post = await BlogPost.findOne({
    slug: slug.toLowerCase().trim(),
    isPublished: true,
    deletedAt: null,
  }).lean();
  return post as unknown as IBlogPost | null;
}

export async function getMarketplaceProductBySlug(slug: string) {
  await connectDB();
  const { branchId } = await getMarketplaceFulfillmentContext();
  const product = await Product.findOne({
    slug: slug.toLowerCase().trim(),
    ...listedFilter,
  }).lean();
  if (!product) return null;

  const variants = await ProductVariant.find({
    productId: product._id,
    deletedAt: null,
    isActive: true,
  })
    .sort({ name: 1 })
    .lean();

  const inv = await Inventory.find({ branchId, productId: product._id }).lean();
  const qtyKey = (productId: string, variantId: string | null) => `${productId}:${variantId ?? ""}`;
  const qtyMap = new Map<string, number>();
  for (const row of inv) {
    const k = qtyKey(row.productId.toString(), row.variantId?.toString() ?? null);
    qtyMap.set(k, (qtyMap.get(k) ?? 0) + row.quantity);
  }

  const baseKey = qtyKey(product._id.toString(), null);
  const baseStock = qtyMap.get(baseKey) ?? 0;

  const variantRows = variants.map((v) => ({
    _id: v._id.toString(),
    name: v.name,
    sku: v.sku,
    retailPrice: v.retailPrice,
    images: v.images ?? [],
    stock: qtyMap.get(qtyKey(product._id.toString(), v._id.toString())) ?? 0,
  }));

  return {
    _id: product._id.toString(),
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription,
    description: product.description,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    category: product.category,
    sku: product.sku,
    images: product.images ?? [],
    video: product.video,
    retailPrice: product.retailPrice,
    baseStock,
    variants: variantRows,
    hasVariants: variantRows.length > 0,
  };
}

export async function placeMarketplaceOrder(
  input: MarketplaceCheckoutInput,
  opts?: { customerUserId?: string | null }
) {
  await connectDB();
  const customerUserId = opts?.customerUserId ?? null;
  const appSettings = await AppSettings.findOne().sort({ _id: 1 }).lean();
  const currency = appSettings?.currency ?? "PHP";

  let cardPaymentRecord: ResolvedMarketplaceCardPayment | undefined;
  let gcashPaymentRecord: ResolvedMarketplaceGcashPayment | undefined;
  let paymongoRecord:
    | { paymentIntentId: string; paymentId?: string; status: string }
    | undefined;

  const paymongoEnabled = isPaymongoConfigured();
  if (!paymongoEnabled && input.paymentMethod !== "cash") {
    throw new Error(
      "Only cash on delivery is available until PayMongo API keys are configured"
    );
  }
  if (
    paymongoEnabled &&
    (input.paymentMethod === "card" || input.paymentMethod === "gcash") &&
    !input.paymongoPaymentIntentId
  ) {
    throw new Error("Complete payment with PayMongo before placing your order");
  }

  if (!input.paymongoPaymentIntentId) {
    if (input.paymentMethod === "card") {
      cardPaymentRecord = await resolveMarketplaceCardPayment(customerUserId, input);
    }
    if (input.paymentMethod === "gcash") {
      gcashPaymentRecord = await resolveMarketplaceGcashPayment(customerUserId, input);
    }
  }

  let bankTransferPaymentRecord: ResolvedMarketplaceBankTransferPayment | undefined;
  if (input.paymentMethod === "bank_transfer") {
    bankTransferPaymentRecord = await resolveMarketplaceBankTransferPayment(
      customerUserId,
      input
    );
  }

  const { branchId, organizationId } = await getMarketplaceFulfillmentContext();
  const cashierId = await resolveMarketplaceCashierId();

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    type Line = {
      productId: Types.ObjectId;
      variantId: Types.ObjectId | null;
      name: string;
      variantName?: string;
      sku: string;
      quantity: number;
      unitPrice: number;
    };

    const lines: Line[] = [];

    // Batch-fetch products, variants, and inventory instead of N queries per item
    const allProductIds = input.items.map((i) => new mongoose.Types.ObjectId(i.productId));
    const allVariantIds = input.items
      .filter((i) => i.variantId)
      .map((i) => new mongoose.Types.ObjectId(i.variantId!));

    const [productDocs, variantDocs, variantCountRows, inventoryDocs] = await Promise.all([
      Product.find({ _id: { $in: allProductIds }, ...listedFilter })
        .session(session)
        .lean(),
      allVariantIds.length > 0
        ? ProductVariant.find({ _id: { $in: allVariantIds }, deletedAt: null, isActive: true })
            .session(session)
            .lean()
        : Promise.resolve([]),
      // Count active variants per product (to detect variant-required products)
      ProductVariant.aggregate([
        { $match: { productId: { $in: allProductIds }, deletedAt: null, isActive: true } },
        { $group: { _id: "$productId", count: { $sum: 1 } } },
      ]).session(session),
      Inventory.find({ branchId, productId: { $in: allProductIds } })
        .session(session)
        .lean(),
    ]);

    const productMap = new Map(productDocs.map((p) => [String(p._id), p]));
    const variantMap = new Map(variantDocs.map((v) => [String(v._id), v]));
    const variantCountMap = new Map<string, number>(
      variantCountRows.map((r: { _id: Types.ObjectId; count: number }) => [String(r._id), r.count])
    );
    // Key: "productId:variantId" (variantId empty string when null)
    const invMap = new Map(
      inventoryDocs.map((inv) => [`${inv.productId}:${inv.variantId ?? ""}`, inv])
    );

    for (const raw of input.items) {
      const product = productMap.get(String(raw.productId));
      if (!product) throw new Error(`Product not available: ${raw.productId}`);

      let unitPrice = product.retailPrice;
      let sku = product.sku;
      const name = product.name;
      let variantName: string | undefined;
      let variantId: Types.ObjectId | null = null;
      let invKey: string;

      if (raw.variantId) {
        const v = variantMap.get(String(raw.variantId));
        if (!v || String(v.productId) !== String(product._id)) {
          throw new Error(`Invalid variant for product ${product.name}`);
        }
        unitPrice = v.retailPrice;
        sku = v.sku;
        variantName = v.name;
        variantId = v._id as Types.ObjectId;
        invKey = `${product._id}:${v._id}`;
      } else {
        if ((variantCountMap.get(String(product._id)) ?? 0) > 0) {
          throw new Error(`Please choose a variant for ${product.name}`);
        }
        invKey = `${product._id}:`;
      }

      const inv = invMap.get(invKey);
      if (!inv || inv.quantity < raw.quantity) {
        throw new Error(`Insufficient stock for ${name}${variantName ? ` (${variantName})` : ""}`);
      }

      lines.push({
        productId: product._id as Types.ObjectId,
        variantId,
        name,
        variantName,
        sku,
        quantity: raw.quantity,
        unitPrice,
      });
    }

    const subtotal = Math.round(
      lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0) * 100
    ) / 100;
    let discountPercent = 0;
    if (customerUserId) {
      const dashboard = await getCustomerDashboard(customerUserId);
      if (dashboard) {
        discountPercent = dashboard.memberDiscountPercent;
      }
    }
    const memberDiscountAmount =
      discountPercent > 0
        ? Math.round((subtotal * Math.min(100, discountPercent)) / 100 * 100) / 100
        : 0;

    const cartUnitPriceForProduct = (productId: string): number | undefined =>
      lines.find((l) => String(l.productId) === productId)?.unitPrice;

    const cartSubtotalForCategory = (category: string): number => {
      let total = 0;
      for (const l of lines) {
        const product = productMap.get(String(l.productId));
        if (product?.category === category) total += l.unitPrice * l.quantity;
      }
      return Math.round(total * 100) / 100;
    };

    let couponId: Types.ObjectId | null = null;
    let couponDiscountAmount = 0;
    let couponFreeShipping = false;
    const couponCode = input.couponCode?.trim();
    if (couponCode) {
      const couponResult = await validateCoupon(couponCode, customerUserId, subtotal, {
        email: input.shipping.email,
        cartUnitPriceForProduct,
        cartSubtotalForCategory,
        session,
      });
      if (!couponResult.ok) throw new Error(couponResult.message);
      couponId = couponResult.couponId;
      couponDiscountAmount = couponResult.discountAmount;
      couponFreeShipping = couponResult.freeShipping === true;
    }

    // Coupon and member discounts don't stack — take whichever is larger.
    const discountAmount = Math.max(memberDiscountAmount, couponDiscountAmount);
    if (couponId && couponDiscountAmount >= memberDiscountAmount) {
      discountPercent = subtotal > 0 ? Math.round((discountAmount / subtotal) * 10000) / 100 : 0;
    }

    const shippingCost = couponFreeShipping
      ? 0
      : computeCheckoutShippingCost(subtotal, input.shippingMethod, {
          discountAmount,
          paymentMethod: input.paymentMethod,
          region: input.shipping.region,
          city: input.shipping.city,
        });
    const total = computeMarketplaceOrderTotal(subtotal, discountAmount, shippingCost);

    let codPaymentRecord: ResolvedMarketplaceCodPayment | undefined;
    if (input.paymentMethod === "cash") {
      codPaymentRecord = await resolveMarketplaceCodPayment(input, total, currency);
    }

    if (input.paymongoPaymentIntentId) {
      const quote = await quoteMarketplaceCheckout(
        {
          items: input.items,
          shippingMethod: input.shippingMethod,
          shipping: input.shipping,
          paymentMethod: input.paymentMethod,
          couponCode: input.couponCode,
        },
        customerUserId,
        { session }
      );
      if (quote.total !== total) {
        throw new Error("Order total changed. Refresh checkout and try again.");
      }
      const expectedMethod = input.paymentMethod === "gcash" ? "gcash" : "card";
      const verified = await verifyMarketplacePaymongoPayment({
        paymentIntentId: input.paymongoPaymentIntentId,
        expectedAmountCentavos: phpAmountToCentavos(total),
        expectedMethod,
      });
      paymongoRecord = {
        paymentIntentId: verified.paymentIntentId,
        paymentId: verified.paymentId,
        status: verified.status,
      };
      if (input.paymentMethod === "card") {
        cardPaymentRecord = {
          cardBrand: verified.cardBrand,
          cardLast4: verified.cardLast4,
          cardholderName: verified.cardholderName,
        };
      }
      if (input.paymentMethod === "gcash") {
        gcashPaymentRecord = {
          accountName: input.shipping.fullName,
          mobileLast4: "0000",
          mobileMasked: "GCash (PayMongo)",
        };
      }
    }

    const orderNumber = generateOrderNumber();
    const paidNow = input.paymongoPaymentIntentId
      ? true
      : isMarketplacePaymentCaptured(input.paymentMethod);
    const status = paidNow ? "paid" : marketplaceOrderStatusForPayment(input.paymentMethod);
    const amountPaid = paidNow ? total : 0;
    const change = Math.max(0, amountPaid - total);

    let orderNotes = input.notes?.trim() || `Marketplace web order — ${input.shipping.email}`;
    if (bankTransferPaymentRecord) {
      const refLine = `Bank transfer ref: ${bankTransferPaymentRecord.transferReference} → ${bankTransferPaymentRecord.depositToBankName}`;
      orderNotes = orderNotes.includes("Bank transfer ref:")
        ? orderNotes
        : `${orderNotes}\n${refLine}`;
    }
    if (codPaymentRecord) {
      let codLine = `COD — pay ${formatCurrency(codPaymentRecord.amountDue, currency)} on delivery`;
      if (codPaymentRecord.prepareChangeFor) {
        codLine += ` (customer pays with ${formatCurrency(codPaymentRecord.prepareChangeFor, currency)}`;
        if (codPaymentRecord.changeToReturn) {
          codLine += `, change ${formatCurrency(codPaymentRecord.changeToReturn, currency)}`;
        }
        codLine += ")";
      }
      orderNotes = orderNotes.includes("COD —")
        ? orderNotes
        : `${orderNotes}\n${codLine}`;
    }

    const customerOid =
      opts?.customerUserId && mongoose.isValidObjectId(opts.customerUserId)
        ? new mongoose.Types.ObjectId(opts.customerUserId)
        : null;

    const [order] = await Order.create(
      [
        {
          branchId,
          organizationId,
          orderNumber,
          type: "MARKETPLACE",
          status,
          memberId: null,
          memberName: input.shipping.fullName,
          cashierId,
          subtotal,
          discountAmount,
          discountPercent,
          couponCode: couponId ? couponCode?.toUpperCase() : undefined,
          couponId: couponId ?? undefined,
          shippingAmount: shippingCost,
          total,
          amountPaid,
          change,
          paymentMethod: input.paymentMethod,
          notes: orderNotes,
          paidAt: paidNow ? new Date() : null,
          marketplaceShipping: {
            fullName: input.shipping.fullName,
            email: input.shipping.email,
            phone: input.shipping.phone,
            line1: input.shipping.line1,
            line2: input.shipping.line2?.trim() || undefined,
            city: input.shipping.city,
            region: input.shipping.region,
            postalCode: input.shipping.postalCode,
            shippingMethod: input.shippingMethod,
            shippingCost,
          },
          marketplaceCardPayment: cardPaymentRecord
            ? {
                savedMethodId: cardPaymentRecord.savedMethodId,
                cardBrand: cardPaymentRecord.cardBrand,
                cardLast4: cardPaymentRecord.cardLast4,
                cardholderName: cardPaymentRecord.cardholderName,
                expMonth: cardPaymentRecord.expMonth,
                expYear: cardPaymentRecord.expYear,
              }
            : undefined,
          marketplaceGcashPayment: gcashPaymentRecord
            ? {
                savedMethodId: gcashPaymentRecord.savedMethodId,
                accountName: gcashPaymentRecord.accountName,
                mobileLast4: gcashPaymentRecord.mobileLast4,
                mobileMasked: gcashPaymentRecord.mobileMasked,
              }
            : undefined,
          marketplaceBankTransferPayment: bankTransferPaymentRecord
            ? {
                savedMethodId: bankTransferPaymentRecord.savedMethodId,
                depositorName: bankTransferPaymentRecord.depositorName,
                depositorBank: bankTransferPaymentRecord.depositorBank,
                accountLast4: bankTransferPaymentRecord.accountLast4,
                transferReference: bankTransferPaymentRecord.transferReference,
                depositToBankId: bankTransferPaymentRecord.depositToBankId,
                depositToBankName: bankTransferPaymentRecord.depositToBankName,
                depositToAccountName: bankTransferPaymentRecord.depositToAccountName,
                depositToAccountNumber: bankTransferPaymentRecord.depositToAccountNumber,
              }
            : undefined,
          marketplaceCodPayment: codPaymentRecord
            ? {
                amountDue: codPaymentRecord.amountDue,
                prepareChangeFor: codPaymentRecord.prepareChangeFor,
                changeToReturn: codPaymentRecord.changeToReturn,
                codAcknowledged: true,
              }
            : undefined,
          marketplacePaymongo: paymongoRecord,
          marketplaceCustomerUserId: customerOid,
        },
      ],
      { session }
    );

    if (couponId) {
      await redeemCoupon(
        couponId,
        customerOid,
        order._id as Types.ObjectId,
        session,
        customerOid ? undefined : input.shipping.email
      );
    }

    const orderItems = lines.map((l) => ({
      orderId: order._id,
      branchId,
      organizationId,
      productId: l.productId,
      variantId: l.variantId,
      productName: l.name,
      variantName: l.variantName,
      sku: l.sku,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      cost: 0,
      total: l.unitPrice * l.quantity,
    }));

    await OrderItem.insertMany(orderItems, { session });

    // Batch inventory deduction + stock movements
    await Inventory.bulkWrite(
      lines.map((l) => ({
        updateOne: {
          filter: { branchId, productId: l.productId, variantId: l.variantId ?? null },
          update: { $inc: { quantity: -l.quantity } },
        },
      })),
      { session }
    );

    await StockMovement.insertMany(
      lines.map((l) => {
        const invKey = `${l.productId}:${l.variantId ?? ""}`;
        const previousQty = invMap.get(invKey)?.quantity ?? 0;
        return {
          branchId,
          organizationId,
          productId: l.productId,
          variantId: l.variantId ?? null,
          type: "OUT",
          quantity: l.quantity,
          previousQuantity: previousQty,
          newQuantity: previousQty - l.quantity,
          reference: orderNumber,
          orderId: order._id,
          performedBy: cashierId,
        };
      }),
      { session }
    );

    if (paidNow) {
      await Transaction.create(
        [
          {
            branchId,
            organizationId,
            orderId: order._id,
            memberId: null,
            type: "SALE",
            amount: total,
            paymentMethod: input.paymentMethod,
            reference: orderNumber,
            notes: "Marketplace",
            performedBy: cashierId,
          },
        ],
        { session }
      );
    }

    await session.commitTransaction();

    if (
      customerUserId &&
      input.savePaymentMethod &&
      input.paymentMethod === "card" &&
      input.cardPayment &&
      !input.savedPaymentMethodId &&
      cardPaymentRecord
    ) {
      try {
        await addCustomerPaymentMethod(customerUserId, {
          type: "card",
          label: `${cardBrandLabel(cardPaymentRecord.cardBrand)} •••• ${cardPaymentRecord.cardLast4}`,
          last4: cardPaymentRecord.cardLast4,
          isDefault: false,
        });
      } catch {
        /* ignore save failure */
      }
    }

    if (
      customerUserId &&
      input.savePaymentMethod &&
      input.paymentMethod === "gcash" &&
      input.gcashPayment &&
      !input.savedPaymentMethodId &&
      gcashPaymentRecord
    ) {
      try {
        await addCustomerPaymentMethod(customerUserId, {
          type: "gcash",
          label: `GCash •••• ${gcashPaymentRecord.mobileLast4} (${gcashPaymentRecord.accountName})`,
          last4: gcashPaymentRecord.mobileLast4,
          isDefault: false,
        });
      } catch {
        /* ignore save failure */
      }
    }

    if (
      customerUserId &&
      input.savePaymentMethod &&
      input.paymentMethod === "bank_transfer" &&
      input.bankTransferPayment &&
      !input.savedPaymentMethodId &&
      bankTransferPaymentRecord?.accountLast4
    ) {
      try {
        await addCustomerPaymentMethod(customerUserId, {
          type: "bank_transfer",
          label: `${bankTransferPaymentRecord.depositorBank} •••• ${bankTransferPaymentRecord.accountLast4} (${bankTransferPaymentRecord.depositorName})`,
          last4: bankTransferPaymentRecord.accountLast4,
          isDefault: false,
        });
      } catch {
        /* ignore save failure */
      }
    }

    if (customerUserId && input.saveAddress) {
      try {
        await addCustomerSavedAddress(customerUserId, {
          label: "Checkout",
          fullName: input.shipping.fullName,
          phone: input.shipping.phone,
          line1: input.shipping.line1,
          line2: input.shipping.line2,
          city: input.shipping.city,
          region: input.shipping.region,
          postalCode: input.shipping.postalCode,
          isDefault: false,
        });
      } catch {
        /* ignore duplicate save */
      }
    }

    try {
      await markAbandonedCheckoutRecovered(input.shipping.email, order._id.toString());
    } catch {
      /* best-effort; never block order placement */
    }

    return {
      orderId: order._id.toString(),
      orderNumber,
      total,
      status,
      subtotal,
      discountAmount,
      shippingCost,
    };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

export type PublicMarketplaceReview = {
  id: string;
  productId: string;
  productName: string;
  productSlug?: string;
  rating: number;
  text: string;
  createdAt: string;
  reviewerName: string;
  images?: string[];
  featured?: boolean;
};

export type ListPublicReviewsOptions = {
  limit?: number;
  productId?: string;
  featuredOnly?: boolean;
};

export type ReviewAggregateStats = {
  averageRating: number | null;
  reviewCount: number;
  fiveStarCount: number;
};

export type ProductReviewSummary = {
  averageRating: number | null;
  reviewCount: number;
};

export type ListPublicReviewsResult = {
  reviews: PublicMarketplaceReview[];
  stats: ReviewAggregateStats;
};

export async function listPublicMarketplaceReviews(
  options: ListPublicReviewsOptions | number = 50
): Promise<ListPublicReviewsResult> {
  const opts: ListPublicReviewsOptions =
    typeof options === "number" ? { limit: options } : options;
  const { limit = 50, productId, featuredOnly } = opts;

  await connectDB();
  const cap = Math.min(100, Math.max(1, limit));

  const postUnwindMatch: Record<string, unknown> = {};
  if (productId) postUnwindMatch["marketplace.reviews.productId"] = productId;
  if (featuredOnly) postUnwindMatch["marketplace.reviews.featured"] = true;

  const [reviews, statsResult] = await Promise.all([
    User.aggregate([
      { $match: { deletedAt: null, "marketplace.reviews.0": { $exists: true } } },
      { $unwind: "$marketplace.reviews" },
      ...(Object.keys(postUnwindMatch).length ? [{ $match: postUnwindMatch }] : []),
      { $sort: { "marketplace.reviews.featured": -1, "marketplace.reviews.createdAt": -1 } },
      { $limit: cap },
      {
        $project: {
          _id: 0,
          id: "$marketplace.reviews.id",
          productId: "$marketplace.reviews.productId",
          productName: "$marketplace.reviews.productName",
          productSlug: "$marketplace.reviews.productSlug",
          rating: "$marketplace.reviews.rating",
          text: "$marketplace.reviews.text",
          createdAt: "$marketplace.reviews.createdAt",
          reviewerName: "$name",
          images: { $ifNull: ["$marketplace.reviews.images", []] },
          featured: { $ifNull: ["$marketplace.reviews.featured", false] },
        },
      },
    ]),
    User.aggregate([
      { $match: { deletedAt: null, "marketplace.reviews.0": { $exists: true } } },
      { $unwind: "$marketplace.reviews" },
      ...(productId ? [{ $match: { "marketplace.reviews.productId": productId } }] : []),
      {
        $group: {
          _id: null,
          reviewCount: { $sum: 1 },
          sumRating: { $sum: "$marketplace.reviews.rating" },
          fiveStarCount: { $sum: { $cond: [{ $eq: ["$marketplace.reviews.rating", 5] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const s = statsResult[0] ?? { reviewCount: 0, sumRating: 0, fiveStarCount: 0 };
  const averageRating =
    s.reviewCount > 0 ? Math.round((s.sumRating / s.reviewCount) * 10) / 10 : null;

  return {
    reviews: reviews as PublicMarketplaceReview[],
    stats: { averageRating, reviewCount: s.reviewCount, fiveStarCount: s.fiveStarCount },
  };
}

export async function getPublicReviewById(
  reviewId: string
): Promise<PublicMarketplaceReview | null> {
  await connectDB();
  const user = await User.findOne({
    deletedAt: null,
    "marketplace.reviews.id": reviewId,
  })
    .select("name marketplace.reviews")
    .lean();

  if (!user) return null;

  const r = (user.marketplace?.reviews ?? []).find(
    (rev: { id: string }) => rev.id === reviewId
  );
  if (!r) return null;

  return {
    id: r.id,
    productId: r.productId,
    productName: r.productName,
    productSlug: r.productSlug,
    rating: r.rating,
    text: r.text,
    createdAt: r.createdAt,
    reviewerName: user.name ?? "Customer",
    images: r.images ?? [],
    featured: r.featured ?? false,
  };
}

/** Per-product average rating and count from stored customer reviews. */
export async function getProductReviewSummaries(
  productIds: string[]
): Promise<Record<string, ProductReviewSummary>> {
  const unique = [...new Set(productIds.filter(Boolean))];
  const out: Record<string, ProductReviewSummary> = {};
  for (const id of unique) out[id] = { averageRating: null, reviewCount: 0 };
  if (!unique.length) return out;

  await connectDB();

  const rows = await User.aggregate<{ _id: string; count: number; sum: number }>([
    { $match: { deletedAt: null, "marketplace.reviews.0": { $exists: true } } },
    { $unwind: "$marketplace.reviews" },
    { $match: { "marketplace.reviews.productId": { $in: unique } } },
    {
      $group: {
        _id: "$marketplace.reviews.productId",
        count: { $sum: 1 },
        sum: { $sum: "$marketplace.reviews.rating" },
      },
    },
  ]);

  for (const row of rows) {
    out[row._id] = {
      averageRating: Math.round((row.sum / row.count) * 10) / 10,
      reviewCount: row.count,
    };
  }
  return out;
}

export async function submitMarketplaceContactMessage(input: {
  name: string;
  email: string;
  subject: string;
  message: string;
}) {
  await connectDB();
  await MarketplaceContactMessage.create({
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    subject: input.subject.trim(),
    message: input.message.trim(),
  });
  return { ok: true };
}
