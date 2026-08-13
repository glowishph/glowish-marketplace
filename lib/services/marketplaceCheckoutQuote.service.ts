import type { ClientSession, Types } from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { Inventory } from "@/lib/db/models/Inventory";
import { Product } from "@/lib/db/models/Product";
import { ProductVariant } from "@/lib/db/models/ProductVariant";
import { getCustomerDashboard } from "@/lib/services/customerDashboard.service";
import { validateCoupon } from "@/lib/services/coupon.service";
import { AppSettings } from "@/lib/db/models/AppSettings";
import { Branch } from "@/lib/db/models/Branch";
import { marketplaceListedMatch as listedFilter } from "@/lib/services/marketplaceShopFilters";
import type { MarketplaceCheckoutInput } from "@/lib/validations/marketplace.schema";
import { phpAmountToCentavos } from "@/lib/paymongo/config";
import {
  computeCheckoutShippingQuote,
  computeMarketplaceOrderTotal,
  getCheckoutShippingMethodsForAddress,
  getMarketplaceShippingOption,
  MARKETPLACE_SHIPPING_METHODS,
} from "@/lib/utils/marketplaceShipping";

export type MarketplaceCheckoutQuote = {
  subtotal: number;
  discountAmount: number;
  discountPercent: number;
  shippingCost: number;
  total: number;
  amountCentavos: number;
  coupon?: {
    code: string;
    applied: boolean;
    message?: string;
    discountAmount?: number;
    freeShipping?: boolean;
  };
};

export type MarketplaceCheckoutQuoteMethod = {
  id: string;
  title: string;
  detail: string;
  supportsCod: boolean;
  baseShipping: number;
  codFee: number;
  shippingCost: number;
};

export type MarketplaceCheckoutQuoteExtended = MarketplaceCheckoutQuote & {
  shippingMethods: MarketplaceCheckoutQuoteMethod[];
  shippingBreakdown?: {
    baseShipping: number;
    codFee: number;
    courier: string;
  };
};

export type MarketplaceCheckoutQuoteInput = Pick<
  MarketplaceCheckoutInput,
  "items" | "shippingMethod" | "shipping"
> & {
  paymentMethod?: MarketplaceCheckoutInput["paymentMethod"];
  couponCode?: string;
};

/** Validates cart lines and stock; returns pricing for checkout / PayMongo intent. */
export async function quoteMarketplaceCheckout(
  input: MarketplaceCheckoutQuoteInput,
  customerUserId: string | null,
  opts?: { session?: ClientSession }
): Promise<MarketplaceCheckoutQuoteExtended> {
  await connectDB();
  const settings = await AppSettings.findOne().sort({ _id: 1 }).lean();
  let branchId = settings?.marketplaceFulfillmentBranchId;
  if (!branchId) {
    const hq = await Branch.findOne({ isHeadOffice: true, deletedAt: null, isActive: true }).lean();
    const fallback =
      hq ?? (await Branch.findOne({ deletedAt: null, isActive: true }).sort({ _id: 1 }).lean());
    if (!fallback) {
      throw new Error(
        "No branch is available to fulfill online orders. Create a branch in Admin first."
      );
    }
    branchId = fallback._id as Types.ObjectId;
  }

  // Batch-fetch all products, variants, variant counts, and inventory in one round
  const allProductIds = input.items.map((i) => i.productId);
  const allVariantIds = input.items.filter((i) => i.variantId).map((i) => i.variantId!);

  const [productDocs, variantDocs, variantCountRows, inventoryDocs] = await Promise.all([
    Product.find({ _id: { $in: allProductIds }, ...listedFilter }).lean(),
    allVariantIds.length > 0
      ? ProductVariant.find({ _id: { $in: allVariantIds }, deletedAt: null, isActive: true }).lean()
      : Promise.resolve([]),
    ProductVariant.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { productId: { $in: allProductIds }, deletedAt: null, isActive: true } },
      { $group: { _id: "$productId", count: { $sum: 1 } } },
    ]),
    Inventory.find({ branchId, productId: { $in: allProductIds } }).lean(),
  ]);

  const productMap = new Map(productDocs.map((p) => [String(p._id), p]));
  const variantMap = new Map(variantDocs.map((v) => [String(v._id), v]));
  const variantCountMap = new Map(variantCountRows.map((r) => [String(r._id), r.count]));
  const invMap = new Map(
    inventoryDocs.map((inv) => [`${inv.productId}:${inv.variantId ?? ""}`, inv])
  );

  // Validate each item using the pre-fetched maps
  for (const raw of input.items) {
    const product = productMap.get(raw.productId);
    if (!product) throw new Error(`Product not available: ${raw.productId}`);

    let variantName: string | undefined;
    let invKey: string;

    if (raw.variantId) {
      const v = variantMap.get(raw.variantId);
      if (!v || String(v.productId) !== String(product._id)) {
        throw new Error(`Invalid variant for product ${product.name}`);
      }
      variantName = v.name;
      invKey = `${product._id}:${v._id}`;
    } else {
      if ((variantCountMap.get(String(product._id)) ?? 0) > 0) {
        throw new Error(`Please choose a variant for ${product.name}`);
      }
      invKey = `${product._id}:`;
    }

    const inv = invMap.get(invKey);
    if (!inv || inv.quantity < raw.quantity) {
      throw new Error(
        `Insufficient stock for ${product.name}${variantName ? ` (${variantName})` : ""}`
      );
    }
  }

  // Compute subtotal from already-fetched maps (no second round of queries)
  let subtotal = 0;
  for (const raw of input.items) {
    const product = productMap.get(raw.productId);
    if (!product) continue;
    let unitPrice = product.retailPrice;
    if (raw.variantId) {
      const v = variantMap.get(raw.variantId);
      if (v) unitPrice = v.retailPrice;
    }
    subtotal += unitPrice * raw.quantity;
  }
  subtotal = Math.round(subtotal * 100) / 100;

  let discountPercent = 0;
  if (customerUserId) {
    const dashboard = await getCustomerDashboard(customerUserId);
    if (dashboard) discountPercent = dashboard.memberDiscountPercent;
  }
  const memberDiscountAmount =
    discountPercent > 0
      ? Math.round((subtotal * Math.min(100, discountPercent)) / 100 * 100) / 100
      : 0;

  const cartUnitPriceForProduct = (productId: string): number | undefined => {
    const item = input.items.find((i) => i.productId === productId);
    if (!item) return undefined;
    if (item.variantId) {
      const v = variantMap.get(item.variantId);
      if (v) return v.retailPrice;
    }
    const product = productMap.get(productId);
    return product?.retailPrice;
  };

  const cartSubtotalForCategory = (category: string): number => {
    let total = 0;
    for (const raw of input.items) {
      const product = productMap.get(raw.productId);
      if (!product || product.category !== category) continue;
      let unitPrice = product.retailPrice;
      if (raw.variantId) {
        const v = variantMap.get(raw.variantId);
        if (v) unitPrice = v.retailPrice;
      }
      total += unitPrice * raw.quantity;
    }
    return Math.round(total * 100) / 100;
  };

  let couponResult: Awaited<ReturnType<typeof validateCoupon>> | undefined;
  let couponDiscountAmount = 0;
  const couponCode = input.couponCode?.trim();
  if (couponCode) {
    couponResult = await validateCoupon(couponCode, customerUserId, subtotal, {
      email: input.shipping?.email,
      cartUnitPriceForProduct,
      cartSubtotalForCategory,
      session: opts?.session,
    });
    if (couponResult.ok) couponDiscountAmount = couponResult.discountAmount;
  }
  const freeShipping = couponResult?.ok === true && couponResult.freeShipping === true;

  // Coupon and member discounts don't stack — take whichever is larger.
  const discountAmount = Math.max(memberDiscountAmount, couponDiscountAmount);
  if (couponDiscountAmount > 0 && couponDiscountAmount >= memberDiscountAmount) {
    discountPercent = subtotal > 0 ? Math.round((discountAmount / subtotal) * 10000) / 100 : 0;
  }

  const region = input.shipping?.region ?? "";
  const city = input.shipping?.city ?? "";
  const paymentMethod = input.paymentMethod;

  const availableMethods = getCheckoutShippingMethodsForAddress(region, city, paymentMethod);
  const methodPool =
    availableMethods.length > 0 ? availableMethods : [...MARKETPLACE_SHIPPING_METHODS];

  const shippingMethods: MarketplaceCheckoutQuoteMethod[] = methodPool.map((method) => {
    const quote = computeCheckoutShippingQuote({
      merchandiseSubtotal: subtotal,
      discountAmount,
      shippingMethod: method.id,
      paymentMethod,
      region,
      city,
    });
    return {
      id: method.id,
      title: method.title,
      detail: method.detail,
      supportsCod: method.supportsCod,
      baseShipping: quote.baseShipping,
      codFee: quote.codFee,
      shippingCost: freeShipping ? 0 : quote.shippingCost,
    };
  });

  const selected =
    shippingMethods.find((m) => m.id === input.shippingMethod) ??
    shippingMethods[0];
  if (!selected) {
    throw new Error("Invalid shipping method");
  }

  const selectedQuote = computeCheckoutShippingQuote({
    merchandiseSubtotal: subtotal,
    discountAmount,
    shippingMethod: selected.id,
    paymentMethod,
    region,
    city,
  });
  const selectedOption = getMarketplaceShippingOption(selected.id);
  const shippingCost = freeShipping ? 0 : selectedQuote.shippingCost;
  const total = computeMarketplaceOrderTotal(subtotal, discountAmount, shippingCost);

  return {
    subtotal,
    discountAmount,
    discountPercent,
    shippingCost,
    total,
    amountCentavos: phpAmountToCentavos(total),
    coupon: couponCode
      ? couponResult && !couponResult.ok
        ? { code: couponCode, applied: false, message: couponResult.message }
        : {
            code: couponCode,
            applied: true,
            discountAmount: couponDiscountAmount,
            freeShipping: freeShipping || undefined,
          }
      : undefined,
    shippingMethods,
    shippingBreakdown: {
      baseShipping: selectedQuote.baseShipping,
      codFee: selectedQuote.codFee,
      courier: selectedOption?.title ?? selectedQuote.courier,
    },
  };
}
