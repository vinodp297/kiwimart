// src/app/api/v1/users/me/route.ts
// ─── Current User API ───────────────────────────────────────────────────────

import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
} from "../../_helpers/response";
import db from "@/lib/db";

export async function GET() {
  try {
    const sessionUser = await requireApiUser();

    const user = await db.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        avatarKey: true,
        region: true,
        bio: true,
        sellerEnabled: true,
        stripeOnboarded: true,
        idVerified: true,
        phoneVerified: true,
        createdAt: true,
      },
    });

    if (!user) {
      return apiError("User not found", 404, "NOT_FOUND");
    }

    return apiOk(user);
  } catch (e) {
    return handleApiError(e);
  }
}
