import { z } from "zod";
import { passwordSchema } from "@/lib/validations/password.schema";

const ROLES = ["ADMIN", "ORG_ADMIN", "BRANCH_MANAGER", "STAFF", "INVENTORY_MANAGER", "MEMBER"] as const;

const organizationIdField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const t = v.trim();
    return t === "" ? null : t;
  });

export const createUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().email("Invalid email address"),
  password: passwordSchema,
  role: z.enum(ROLES),
  branchIds: z.array(z.string()).default([]),
  organizationId: organizationIdField,
  phone: z.string().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  role: z.enum(ROLES).optional(),
  branchIds: z.array(z.string()).optional(),
  organizationId: organizationIdField,
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
  permissions: z.array(z.string()).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
