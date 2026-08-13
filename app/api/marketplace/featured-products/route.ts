import { getFeaturedHeroProductSummaries } from "@/lib/services/featuredProducts.service";
import { errorResponse, serverErrorResponse, successResponse } from "@/lib/utils/apiResponse";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const placement = searchParams.get("placement");
    if (placement !== "home" && placement !== "shop") {
      return errorResponse('Query param "placement" must be "home" or "shop"', 400);
    }
    const data = await getFeaturedHeroProductSummaries(placement);
    const res = successResponse(data);
    res.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load featured products";
    return serverErrorResponse(msg);
  }
}
