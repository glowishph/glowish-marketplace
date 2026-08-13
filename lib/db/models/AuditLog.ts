import { Schema, model, models, type Document, type Types } from "mongoose";

export type AuditAction =
  | "user.created"
  | "user.updated"
  | "user.role_changed"
  | "user.deleted"
  | "user.locked"
  | "settings.updated"
  | "order.refunded"
  | "organization.created"
  | "organization.updated"
  | "organization.deleted"
  | "branch.updated"
  | "branch.deleted"
  | "member.status_changed"
  | "member.deleted"
  | "commission.paid"
  | "commission.cancelled"
  | "product.created"
  | "product.updated"
  | "product.deleted"
  | "product.cloned"
  | "product.variant_created"
  | "product.variant_updated"
  | "product.variant_deleted"
  | "order.created"
  | "order.status_changed"
  | "abandoned_checkout.deleted"
  | "reseller_order.created"
  | "inventory.threshold_updated"
  | "inventory.stock_moved"
  | "inventory.org_transferred"
  | "supplier.created"
  | "supplier.updated"
  | "supplier.deleted"
  | "organization.permission_changed"
  | "organization.admin_password_reset"
  | "branch.created"
  | "branch.user_assigned"
  | "branch.user_removed"
  | "member.created"
  | "settings.logo_updated"
  | "settings.logo_removed"
  | "settings.impact_image_updated"
  | "settings.impact_image_removed"
  | "marketplace.featured_products_refreshed"
  | "settings.maintenance_toggled"
  | "settings.roles_synced"
  | "user.2fa_enabled"
  | "user.2fa_disabled"
  | "user.password_changed"
  | "user.account_deleted"
  | "review.created"
  | "review.deleted"
  | "review.featured_changed"
  | "ad.created"
  | "ad.updated"
  | "ad.deleted"
  | "blog_post.created"
  | "blog_post.updated"
  | "blog_post.deleted"
  | "coupon.created"
  | "coupon.updated"
  | "coupon.deleted"
  | "db.backup_created"
  | "db.backup_deleted"
  | "db.restored"
  | "db.transferred";

export interface IAuditLog extends Document {
  action: AuditAction;
  performedBy: Types.ObjectId | string;
  performedByName?: string | null;
  targetId?: string | null;
  targetType?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    action: { type: String, required: true },
    performedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    performedByName: { type: String, default: null },
    targetId: { type: String, default: null },
    targetType: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ performedBy: 1, createdAt: -1 });
AuditLogSchema.index({ targetId: 1, createdAt: -1 });

export const AuditLog = models.AuditLog || model<IAuditLog>("AuditLog", AuditLogSchema);
