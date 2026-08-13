import { revalidateTag } from "next/cache";
import { connectDB } from "@/lib/db/connect";
import { Product, type IProduct } from "@/lib/db/models/Product";
import { ProductVariant } from "@/lib/db/models/ProductVariant";
import { Inventory } from "@/lib/db/models/Inventory";
import { slugify } from "@/lib/utils";
import { parseCsv, serializeCsv } from "@/lib/utils/csv";
import {
  createProductSchema,
  type CreateProductInput,
  type CreateVariantInput,
} from "@/lib/validations/product.schema";
import type { ProductCategory } from "@/types";
import { deleteMediaAssetsByUrls } from "@/lib/services/media.service";
import { writeAuditLog, type AuditActor } from "@/lib/services/audit.service";

async function cleanupRemovedImageUrls(previous: string[] | undefined, next: string[] | undefined) {
  const nextSet = new Set(next ?? []);
  const removed = (previous ?? []).filter((url) => !nextSet.has(url));
  if (removed.length) await deleteMediaAssetsByUrls(removed);
}

interface ProductFilter {
  category?: ProductCategory;
  search?: string;
  isActive?: boolean;
}

interface GetProductsOptions {
  includeVariantSummary?: boolean;
}

export async function getProducts(
  filter: ProductFilter = {},
  page = 1,
  limit = 20,
  options: GetProductsOptions = {}
) {
  await connectDB();

  const query: Record<string, unknown> = { deletedAt: null };
  if (filter.category) query.category = filter.category;
  if (filter.isActive !== undefined) query.isActive = filter.isActive;
  if (filter.search) {
    query.$text = { $search: filter.search };
  }

  const skip = (page - 1) * limit;
  const [products, total] = await Promise.all([
    Product.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Product.countDocuments(query),
  ]);

  if (options.includeVariantSummary && products.length) {
    const productIds = products.map((p) => p._id);

    const variantSummaries = await ProductVariant.aggregate<{
      _id: unknown;
      count: number;
      firstVariant?: { name: string; sku: string };
    }>([
      { $match: { productId: { $in: productIds }, deletedAt: null } },
      // "firstVariant" is the most recently created variant (best effort ordering).
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$productId",
          count: { $sum: 1 },
          firstVariant: {
            $first: { name: "$name", sku: "$sku" },
          },
        },
      },
    ]);

    const summaryMap = new Map(
      variantSummaries.map((s) => [String(s._id), s] as const)
    );

    const enriched = products.map((p) => {
      const s = summaryMap.get(String(p._id));
      return {
        ...p,
        variantCount: s?.count ?? 0,
        variantPreviewName: s?.firstVariant?.name ?? null,
        variantPreviewSku: s?.firstVariant?.sku ?? null,
      };
    });

    return { products: enriched, total, pages: Math.ceil(total / limit) };
  }

  return { products, total, pages: Math.ceil(total / limit) };
}

export async function getProductById(productId: string) {
  await connectDB();
  const product = await Product.findOne({ _id: productId, deletedAt: null }).lean();
  if (!product) return null;

  const variants = await ProductVariant.find({ productId, deletedAt: null }).lean();

  return { ...product, variants };
}

const MAX_SKU_LEN = 50;

function stripCopySuffix(sku: string): string {
  return sku.replace(/(-COPY(-\d+)?)+$/i, "");
}

async function nextAvailableSku(
  baseSku: string,
  exists: (sku: string) => Promise<boolean>
): Promise<string> {
  const root = stripCopySuffix(baseSku.trim()).slice(0, 36) || "SKU";
  for (let n = 0; n < 100; n++) {
    const suffix = n === 0 ? "-COPY" : `-COPY-${n + 1}`;
    const candidate = `${root}${suffix}`.slice(0, MAX_SKU_LEN);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error("Could not generate a unique SKU");
}

function copyProductName(name: string): string {
  const suffix = " (Copy)";
  const max = 200;
  if (name.length + suffix.length <= max) return `${name}${suffix}`;
  return `${name.slice(0, max - suffix.length)}${suffix}`;
}

export async function createProduct(data: CreateProductInput, actor?: AuditActor) {
  await connectDB();

  const existingSku = await Product.findOne({ sku: data.sku });
  if (existingSku) throw new Error(`SKU "${data.sku}" already exists`);

  const slug = slugify(data.name);
  const product = await Product.create({ ...data, slug });
  revalidateTag("marketplace-products", "seconds");

  if (actor) {
    void writeAuditLog({
      action: "product.created",
      actor,
      targetId: product._id.toString(),
      targetType: "Product",
      metadata: { name: data.name, sku: data.sku },
    });
  }

  return product;
}

export async function cloneProduct(productId: string, actor?: AuditActor) {
  await connectDB();

  const source = await getProductById(productId);
  if (!source) throw new Error("Product not found");

  const newSku = await nextAvailableSku(source.sku, async (sku) => {
    const found = await Product.findOne({ sku });
    return !!found;
  });

  const newName = copyProductName(source.name);
  const product = await Product.create({
    name: newName,
    slug: slugify(newName),
    shortDescription: source.shortDescription,
    description: source.description,
    seoTitle: source.seoTitle,
    seoDescription: source.seoDescription,
    category: source.category,
    sku: newSku,
    images: source.images ?? [],
    retailPrice: source.retailPrice,
    isActive: source.isActive,
    tags: source.tags ?? [],
    marketplaceListed: source.marketplaceListed ?? true,
  });

  const variants = source.variants ?? [];
  if (variants.length > 0) {
    const variantDocs = [];
    for (const v of variants) {
      const variantSku = await nextAvailableSku(v.sku, async (sku) => {
        const found = await ProductVariant.findOne({ sku });
        return !!found;
      });
      variantDocs.push({
        productId: product._id,
        name: v.name,
        sku: variantSku,
        attributes: v.attributes ?? [],
        retailPrice: v.retailPrice,
        images: v.images ?? [],
        isActive: v.isActive !== false,
      });
    }
    await ProductVariant.insertMany(variantDocs);
  }

  if (actor) {
    void writeAuditLog({
      action: "product.cloned",
      actor,
      targetId: String(product._id),
      targetType: "Product",
      metadata: { sourceProductId: productId, name: newName },
    });
  }

  return getProductById(String(product._id));
}

export async function updateProduct(productId: string, data: Partial<IProduct>, actor?: AuditActor) {
  await connectDB();

  if (data.images !== undefined) {
    const existing = await Product.findOne({ _id: productId, deletedAt: null })
      .select("images")
      .lean();
    if (existing) {
      await cleanupRemovedImageUrls(
        existing.images as string[] | undefined,
        data.images as string[]
      );
    }
  }

  const result = await Product.findOneAndUpdate(
    { _id: productId, deletedAt: null },
    { $set: data },
    { new: true, runValidators: true }
  ).lean();

  if (result) {
    revalidateTag("marketplace-products", "seconds");
  }

  if (result && actor) {
    void writeAuditLog({
      action: "product.updated",
      actor,
      targetId: productId,
      targetType: "Product",
      metadata: { fields: Object.keys(data) },
    });
  }

  return result;
}

export async function deleteProduct(productId: string, actor?: AuditActor) {
  await connectDB();

  // Soft delete: the product (and its images) may still be referenced by historical
  // orders/invoices, so storage assets are left in place rather than deleted here.
  await ProductVariant.updateMany(
    { productId, deletedAt: null },
    { $set: { deletedAt: new Date(), isActive: false } }
  );

  const result = await Product.findOneAndUpdate(
    { _id: productId },
    { $set: { deletedAt: new Date(), isActive: false } },
    { new: true }
  ).lean();

  if (result) {
    revalidateTag("marketplace-products", "seconds");
  }

  if (result && actor) {
    void writeAuditLog({
      action: "product.deleted",
      actor,
      targetId: productId,
      targetType: "Product",
      metadata: { name: result.name },
    });
  }

  return result;
}

export async function createProductVariant(
  productId: string,
  data: CreateVariantInput,
  actor?: AuditActor
) {
  await connectDB();
  const existingSku = await ProductVariant.findOne({ sku: data.sku });
  if (existingSku) throw new Error(`SKU "${data.sku}" already exists`);
  const variant = await ProductVariant.create({ ...data, productId });

  if (actor) {
    void writeAuditLog({
      action: "product.variant_created",
      actor,
      targetId: String(variant._id),
      targetType: "ProductVariant",
      metadata: { productId, name: data.name, sku: data.sku },
    });
  }

  return variant;
}

export async function getProductVariants(productId: string) {
  await connectDB();
  return ProductVariant.find({ productId, deletedAt: null }).lean();
}

export async function updateProductVariant(
  variantId: string,
  data: Partial<CreateVariantInput>,
  actor?: AuditActor
) {
  await connectDB();

  if (data.images !== undefined) {
    const existing = await ProductVariant.findOne({ _id: variantId, deletedAt: null })
      .select("images")
      .lean();
    if (existing) {
      await cleanupRemovedImageUrls(
        existing.images as string[] | undefined,
        data.images as string[]
      );
    }
  }

  const result = await ProductVariant.findOneAndUpdate(
    { _id: variantId, deletedAt: null },
    { $set: data },
    { new: true, runValidators: true }
  ).lean();

  if (result && actor) {
    void writeAuditLog({
      action: "product.variant_updated",
      actor,
      targetId: variantId,
      targetType: "ProductVariant",
      metadata: { fields: Object.keys(data) },
    });
  }

  return result;
}

export async function deleteProductVariant(variantId: string, actor?: AuditActor) {
  await connectDB();

  // Soft delete: leave storage assets in place since historical orders may still
  // reference this variant's images (see deleteProduct for the same reasoning).
  const result = await ProductVariant.findOneAndUpdate(
    { _id: variantId },
    { $set: { deletedAt: new Date(), isActive: false } },
    { new: true }
  ).lean();

  if (result && actor) {
    void writeAuditLog({
      action: "product.variant_deleted",
      actor,
      targetId: variantId,
      targetType: "ProductVariant",
    });
  }

  return result;
}

export async function getProductsForPOS(branchId: string, search?: string) {
  await connectDB();

  const query: Record<string, unknown> = { isActive: true, deletedAt: null };
  if (search) query.$text = { $search: search };

  const products = await Product.find(query).sort({ name: 1 }).limit(50).lean();
  const productIds = products.map((p) => p._id);

  const [inventoryItems, variantsList] = await Promise.all([
    Inventory.find({ branchId, productId: { $in: productIds } }).lean(),
    ProductVariant.find({ productId: { $in: productIds }, isActive: true, deletedAt: null }).lean(),
  ]);

  const baseStockMap = new Map<string, number>();
  const variantStockMap = new Map<string, number>();
  for (const item of inventoryItems) {
    const key = item.productId.toString();
    if (!item.variantId) {
      baseStockMap.set(key, (baseStockMap.get(key) ?? 0) + item.quantity);
    } else {
      variantStockMap.set(item.variantId.toString(), item.quantity);
    }
  }

  const variantsByProduct = new Map<string, typeof variantsList>();
  for (const v of variantsList) {
    const pid = v.productId.toString();
    if (!variantsByProduct.has(pid)) variantsByProduct.set(pid, []);
    variantsByProduct.get(pid)!.push(v);
  }

  return products.map((p) => {
    const pid = p._id.toString();
    const productVariants = variantsByProduct.get(pid) ?? [];
    const variantsWithStock = productVariants.map((v) => ({
      ...v,
      stock: variantStockMap.get(v._id.toString()) ?? 0,
    }));
    return {
      ...p,
      stock: baseStockMap.get(pid) ?? 0,
      variants: variantsWithStock,
    };
  });
}

const IMPORT_MAX_ROWS = 5000;

const CSV_HEADERS_REQUIRED = [
  "sku",
  "name",
  "category",
  "barcode",
  "retailprice",
  "isactive",
  "tags",
] as const;

const CSV_HEADERS_EXPORT = [
  ...CSV_HEADERS_REQUIRED.slice(0, 2),
  "shortdescription",
  "description",
  "seotitle",
  "seodescription",
  ...CSV_HEADERS_REQUIRED.slice(2, -1),
  "marketplacelisted",
  ...CSV_HEADERS_REQUIRED.slice(-1),
] as const;

function normalizeCsvHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_]+/g, "");
}

function parsePriceCell(raw: string): number | null {
  const s = raw.replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseBoolCell(raw: string, defaultVal: boolean): boolean {
  const v = raw.trim().toLowerCase();
  if (!v) return defaultVal;
  if (["1", "true", "yes", "y"].includes(v)) return true;
  if (["0", "false", "no", "n"].includes(v)) return false;
  return defaultVal;
}

function parseTagsCell(raw: string): string[] {
  if (!raw.trim()) return [];
  if (raw.includes(";")) return raw.split(";").map((t) => t.trim()).filter(Boolean);
  return raw.split(",").map((t) => t.trim()).filter(Boolean);
}

export async function exportProductsToCsv(): Promise<string> {
  await connectDB();
  const products = await Product.find({ deletedAt: null }).sort({ sku: 1 }).lean();
  const dataRows: string[][] = products.map((p) => [
    p.sku,
    p.name,
    p.shortDescription ?? "",
    p.description ?? "",
    p.seoTitle ?? "",
    p.seoDescription ?? "",
    p.category,
    p.barcode ?? "",
    String(p.retailPrice),
    p.isActive ? "true" : "false",
    p.marketplaceListed !== false ? "true" : "false",
    (p.tags ?? []).join("; "),
  ]);
  return "\uFEFF" + serializeCsv([[...CSV_HEADERS_EXPORT], ...dataRows]);
}

export interface ProductImportRowError {
  row: number;
  sku?: string;
  message: string;
}

export interface ProductImportResult {
  created: number;
  updated: number;
  errors: ProductImportRowError[];
}

export async function importProductsFromCsv(csv: string): Promise<ProductImportResult> {
  await connectDB();
  const rows = parseCsv(csv);
  const errors: ProductImportRowError[] = [];

  if (rows.length < 2) {
    return {
      created: 0,
      updated: 0,
      errors: [{ row: 1, message: "CSV must include a header row and at least one data row." }],
    };
  }

  const headerRow = rows[0]!.map(normalizeCsvHeader);
  const col = (key: string) => headerRow.indexOf(normalizeCsvHeader(key));

  for (const key of CSV_HEADERS_REQUIRED) {
    if (col(key) < 0) {
      errors.push({
        row: 1,
        message: `Missing required column "${key}". Expected: ${CSV_HEADERS_REQUIRED.join(", ")}.`,
      });
      return { created: 0, updated: 0, errors };
    }
  }

  const dataRowCount = rows.length - 1;
  if (dataRowCount > IMPORT_MAX_ROWS) {
    return {
      created: 0,
      updated: 0,
      errors: [{ row: 0, message: `Too many rows (max ${IMPORT_MAX_ROWS}).` }],
    };
  }

  let created = 0;
  let updated = 0;

  for (let i = 1; i < rows.length; i++) {
    const line = rows[i]!;
    const rowNum = i + 1;
    const get = (key: string) => {
      const idx = col(key);
      return idx >= 0 && idx < line.length ? line[idx]! : "";
    };

    const sku = get("sku").trim();
    if (!sku) {
      errors.push({ row: rowNum, message: "SKU is empty." });
      continue;
    }

    const name = get("name").trim();
    const shortDescription = get("shortdescription").trim();
    const description = get("description").trim();
    const seoTitle = get("seotitle").trim();
    const seoDescription = get("seodescription").trim();
    const categoryRaw = get("category").trim().toLowerCase() as ProductCategory;
    const barcode = get("barcode").trim();
    const retailPrice = parsePriceCell(get("retailprice"));
    const isActive = parseBoolCell(get("isactive"), true);
    const marketplaceListed = parseBoolCell(get("marketplacelisted"), true);
    const tags = parseTagsCell(get("tags"));

    if (retailPrice === null) {
      errors.push({ row: rowNum, sku, message: "Invalid or missing retail price." });
      continue;
    }

    const payload = {
      name,
      shortDescription: shortDescription || undefined,
      description: description || undefined,
      seoTitle: seoTitle || undefined,
      seoDescription: seoDescription || undefined,
      category: categoryRaw,
      sku,
      barcode: barcode || undefined,
      retailPrice,
      isActive,
      marketplaceListed,
      tags,
      images: [] as string[],
    };

    const parsed = createProductSchema.safeParse(payload);
    if (!parsed.success) {
      errors.push({
        row: rowNum,
        sku,
        message: parsed.error.issues.map((e) => e.message).join("; "),
      });
      continue;
    }

    try {
      const existing = await Product.findOne({ sku: parsed.data.sku, deletedAt: null }).lean();
      if (existing) {
        await Product.findOneAndUpdate(
          { _id: existing._id, deletedAt: null },
          {
            $set: {
              ...parsed.data,
              slug: slugify(parsed.data.name),
            },
          },
          { runValidators: true }
        );
        updated++;
      } else {
        await createProduct(parsed.data);
        created++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed.";
      errors.push({ row: rowNum, sku, message: msg });
    }
  }

  return { created, updated, errors };
}
