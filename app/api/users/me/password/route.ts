import bcrypt from "bcryptjs";
import { withStaffAuth } from "@/lib/middleware/withStaffAuth";
import { connectDB } from "@/lib/db/connect";
import { User } from "@/lib/db/models/User";
import { changePasswordSchema } from "@/lib/validations/auth.schema";
import {
  successResponse,
  errorResponse,
  serverErrorResponse,
} from "@/lib/utils/apiResponse";
import { writeAuditLog } from "@/lib/services/audit.service";
import type { AuthedRequest } from "@/lib/middleware/withAuth";

const patchHandler = async (req: AuthedRequest) => {
  try {
    const body = await req.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((e) => e.message).join(", "));
    }

    await connectDB();
    const user = await User.findOne({ _id: req.user.id, deletedAt: null })
      .select("+password")
      .lean();

    if (!user) return errorResponse("User not found", 404);

    const isValid = await bcrypt.compare(parsed.data.currentPassword, user.password);
    if (!isValid) return errorResponse("Current password is incorrect");

    const hashed = await bcrypt.hash(parsed.data.newPassword, 12);
    await User.updateOne(
      { _id: req.user.id },
      { $set: { password: hashed }, $inc: { tokenVersion: 1 } }
    );

    void writeAuditLog({
      action: "user.password_changed",
      actor: { id: req.user.id, name: req.user.name },
      targetId: req.user.id,
      targetType: "User",
    });

    return successResponse(null, "Password changed successfully");
  } catch {
    return serverErrorResponse();
  }
};

export const PATCH = withStaffAuth(patchHandler);
