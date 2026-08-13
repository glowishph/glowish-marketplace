import { withStaffAuth } from "@/lib/middleware/withStaffAuth";
import { withPermission } from "@/lib/middleware/withPermission";
import { refreshFeaturedProductSelection } from "@/lib/services/featuredProducts.service";
import { serverErrorResponse, successResponse } from "@/lib/utils/apiResponse";
import type { AuthedRequest } from "@/lib/middleware/withAuth";

const postHandler = async (req: AuthedRequest) => {
  try {
    await refreshFeaturedProductSelection({ id: req.user.id, name: req.user.name });
    return successResponse({ refreshed: true }, "Featured banner products refreshed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to refresh featured products";
    return serverErrorResponse(msg);
  }
};

export const POST = withStaffAuth(withPermission("manage:products")(postHandler));
