import { refreshFeaturedProductSelection } from "@/lib/services/featuredProducts.service";
import { errorResponse, serverErrorResponse, successResponse } from "@/lib/utils/apiResponse";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    await refreshFeaturedProductSelection();
    return successResponse({ refreshed: true }, "Featured banner products refreshed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to refresh featured products";
    return serverErrorResponse(msg);
  }
}
