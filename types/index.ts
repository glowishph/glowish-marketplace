import { Types } from "mongoose";

// ─── Enums ──────────────────────────────────────────────────────────────────

export type UserRole =
  | "ADMIN"
  | "ORG_ADMIN"
  | "BRANCH_MANAGER"
  | "STAFF"
  | "INVENTORY_MANAGER"
  | "MEMBER"
  | "CUSTOMER";

/** Default role for self-service storefront signup (`/account/register`). */
export const DEFAULT_MARKETPLACE_SIGNUP_ROLE: UserRole = "CUSTOMER";

export type ProductCategory = "homecare" | "cosmetics" | "wellness" | "scent";

export type StockMovementType = "IN" | "OUT" | "TRANSFER" | "ADJUSTMENT";

export type OrderType = "POS" | "DISTRIBUTOR" | "B2B" | "MARKETPLACE";

export type OrderStatus =
  | "pending"
  | "approved"
  | "paid"
  | "delivered"
  | "completed"
  | "cancelled"
  | "refunded";

/** Payment captured; includes fulfilled-but-not-closed orders. */
export const ORDER_PAID_STATUSES: readonly OrderStatus[] = ["paid", "delivered", "completed"];

export type MemberStatus = "active" | "inactive" | "suspended";

export type PurchaseOrderStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "declined"
  | "received"
  | "cancelled";

export type OrganizationType = "distributor" | "franchise" | "partner" | "headquarters";

// ─── API Response ────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
    totalPages?: number;
    [key: string]: unknown;
  };
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface JWTPayload {
  userId: string;
  role: UserRole;
  branchIds: string[];
  permissions: string[];
}

export type OrganizationCapabilities = {
  inventorySurface: "branch" | "organization" | "none";
  posSurface: "branch" | "none";
};

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  branchIds: string[];
  organizationId?: string | null;
  organizationType?: OrganizationType | null;
  organizationCapabilities?: OrganizationCapabilities | null;
  permissions: string[];
  image?: string;
  impersonatorId?: string | null;
}

// ─── Shared Base ─────────────────────────────────────────────────────────────

export interface BaseDocument {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

// ─── Cart (Zustand) ───────────────────────────────────────────────────────────

export interface CartItem {
  productId: string;
  variantId?: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
  image?: string;
  maxStock: number;
}

export interface CartState {
  items: CartItem[];
  memberId: string | null;
  memberName: string | null;
  discountPercent: number;
  branchId: string;
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  removeItem: (productId: string, variantId?: string) => void;
  updateQuantity: (productId: string, quantity: number, variantId?: string) => void;
  setMember: (memberId: string | null, memberName: string | null, discount: number) => void;
  clearCart: () => void;
  setBranchId: (id: string) => void;
  getSubtotal: () => number;
  getDiscount: () => number;
  getTotal: () => number;
}
