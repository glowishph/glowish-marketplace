import { withStaffAuth } from "@/lib/middleware/withStaffAuth";
import { imageUploadConfigured } from "@/lib/server/imageStorage";
import logger from "@/lib/logger";
import { collectImageFilesFromFormData } from "@/lib/server/imageUpload";
import { removeImpactImage, uploadImpactImage } from "@/lib/services/appImpact.service";
import {
  CloudinaryUploadError,
  httpStatusForCloudinaryError,
} from "@/lib/server/cloudinaryErrors";
import {
  errorResponse,
  forbiddenResponse,
  serverErrorResponse,
  successResponse,
} from "@/lib/utils/apiResponse";
import type { AuthedRequest } from "@/lib/middleware/withAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

const postHandler = async (req: AuthedRequest) => {
  if (req.user.role !== "ADMIN") {
    return forbiddenResponse("Only administrators can update the impact block image");
  }
  try {
    if (!imageUploadConfigured()) {
      return errorResponse(
        "Image upload is not available. Configure Cloudinary or ensure the server can write to public/uploads.",
        503
      );
    }

    const formData = await req.formData();
    const files = collectImageFilesFromFormData(formData);
    if (files.length === 0) {
      return errorResponse('No image file received. Send multipart field "file".', 400);
    }
    if (files.length > 1) {
      return errorResponse("Upload one image at a time.", 400);
    }

    const settings = await uploadImpactImage(files[0]!, { id: req.user.id, name: req.user.name });
    return successResponse(settings, "Impact block image updated", 201);
  } catch (e) {
    logger.error({ err: e }, "[POST /api/settings/app/impact-image]");
    if (e instanceof CloudinaryUploadError) {
      return errorResponse(e.message, httpStatusForCloudinaryError(e));
    }
    if (e instanceof Error) return errorResponse(e.message, 500);
    return serverErrorResponse();
  }
};

const deleteHandler = async (req: AuthedRequest) => {
  if (req.user.role !== "ADMIN") {
    return forbiddenResponse("Only administrators can remove the impact block image");
  }
  try {
    const settings = await removeImpactImage({ id: req.user.id, name: req.user.name });
    return successResponse(settings, "Impact block image reset to default");
  } catch (e) {
    logger.error({ err: e }, "[DELETE /api/settings/app/impact-image]");
    if (e instanceof Error) return errorResponse(e.message, 500);
    return serverErrorResponse();
  }
};

export const POST = withStaffAuth(postHandler);
export const DELETE = withStaffAuth(deleteHandler);
