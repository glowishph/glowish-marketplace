import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/db/connect";
import { User } from "@/lib/db/models/User";
import { successResponse, errorResponse, serverErrorResponse } from "@/lib/utils/apiResponse";
import { z } from "zod";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((e) => e.message).join(", "));
    }

    const { token, password } = parsed.data;
    await connectDB();

    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpiry: { $gt: new Date() },
      deletedAt: null,
    }).select("+passwordResetToken +passwordResetExpiry");

    if (!user) {
      return errorResponse("This reset link is invalid or has expired.", 400);
    }

    const hashed = await bcrypt.hash(password, 12);
    await User.updateOne(
      { _id: user._id },
      {
        $set: { password: hashed },
        $unset: { passwordResetToken: "", passwordResetExpiry: "" },
        $inc: { tokenVersion: 1 },
      }
    );

    return successResponse(null, "Password reset successfully. You can now sign in.");
  } catch {
    return serverErrorResponse();
  }
}
