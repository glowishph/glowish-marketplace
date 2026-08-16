import { Schema, model, models, type Document, type Types } from "mongoose";
import type {
  MarketplaceCustomerReview,
  MarketplacePaymentMethod,
  MarketplaceSavedAddress,
  MarketplaceWishlistItem,
} from "@/lib/types/customerAccount";
import type { UserRole } from "@/types";

export interface IUserMarketplace {
  wishlist: MarketplaceWishlistItem[];
  savedAddresses: MarketplaceSavedAddress[];
  paymentMethods: MarketplacePaymentMethod[];
  reviews: MarketplaceCustomerReview[];
}

export interface IUser extends Document {
  branchIds: Types.ObjectId[];
  organizationId?: Types.ObjectId | null;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  permissions: string[];
  avatar?: string;
  phone?: string;
  isActive: boolean;
  emailVerified: boolean;
  emailVerificationToken?: string | null;
  emailVerificationExpiry?: Date | null;
  lastLoginAt?: Date;
  failedLoginAttempts: number;
  lockedUntil?: Date | null;
  totpSecret?: string | null;
  totpEnabled: boolean;
  totpBackupCodes?: string[] | null;
  passwordResetToken?: string | null;
  passwordResetExpiry?: Date | null;
  tokenVersion: number;
  marketplace?: IUserMarketplace;
  marketingOptIn: boolean;
  marketingOptInUpdatedAt?: Date | null;
  welcomeCouponIssuedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

const WishlistItemSchema = new Schema(
  {
    productId: { type: String, required: true },
    variantId: { type: String, default: null },
    slug: { type: String, required: true },
    name: { type: String, required: true },
    variantName: { type: String },
    sku: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    image: { type: String },
    addedAt: { type: String, required: true },
  },
  { _id: false }
);

const SavedAddressSchema = new Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: { type: String },
    city: { type: String, required: true },
    region: { type: String, required: true },
    postalCode: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: false }
);

const PaymentMethodSchema = new Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ["card", "gcash", "bank_transfer"],
      required: true,
    },
    label: { type: String, required: true },
    last4: { type: String },
    isDefault: { type: Boolean, default: false },
  },
  { _id: false }
);

const CustomerReviewSchema = new Schema(
  {
    id: { type: String, required: true },
    productId: { type: String, required: true },
    productName: { type: String, required: true },
    productSlug: { type: String },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, required: true },
    createdAt: { type: String, required: true },
    images: { type: [String], default: [] },
    featured: { type: Boolean, default: false },
  },
  { _id: false }
);

const MarketplaceSchema = new Schema(
  {
    wishlist: { type: [WishlistItemSchema], default: [] },
    savedAddresses: { type: [SavedAddressSchema], default: [] },
    paymentMethods: { type: [PaymentMethodSchema], default: [] },
    reviews: { type: [CustomerReviewSchema], default: [] },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    branchIds: [{ type: Schema.Types.ObjectId, ref: "Branch" }],
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      required: true,
      enum: ["ADMIN", "ORG_ADMIN", "BRANCH_MANAGER", "STAFF", "INVENTORY_MANAGER", "MEMBER", "CUSTOMER"],
    },
    permissions: [{ type: String }],
    avatar: { type: String },
    phone: { type: String },
    isActive: { type: Boolean, default: true },
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false, default: null },
    emailVerificationExpiry: { type: Date, select: false, default: null },
    lastLoginAt: { type: Date },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    totpSecret: { type: String, select: false, default: null },
    totpEnabled: { type: Boolean, default: false },
    totpBackupCodes: { type: [String], select: false, default: null },
    passwordResetToken: { type: String, select: false, default: null },
    passwordResetExpiry: { type: Date, select: false, default: null },
    tokenVersion: { type: Number, default: 0 },
    marketplace: { type: MarketplaceSchema, default: () => ({}) },
    marketingOptIn: { type: Boolean, default: true },
    marketingOptInUpdatedAt: { type: Date, default: null },
    welcomeCouponIssuedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ role: 1, deletedAt: 1 });
UserSchema.index({ branchIds: 1, deletedAt: 1 });
UserSchema.index({ emailVerificationToken: 1 }, { sparse: true });
UserSchema.index({ passwordResetToken: 1 }, { sparse: true });

export const User = models.User || model<IUser>("User", UserSchema);
